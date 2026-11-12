// Needs you (spec 019 T034, apps/web/src/features/inbox.tsx): every open approval and question across chats and every
// memory a summary proposed, newest first, filtered by kind. Deciding here is the same as deciding in the chat.
// The list refreshes when a chat's status changes (the Store's StatusChanged), as the web refetches on its key.
// ponytail: a routine's "uncertain" step (spec 013) and editing an "Ask me" step land with the routines screen (T054).
use gpui_kit::{base::input::TextareaState, prelude::FluentBuilder, *};
use rust_i18n::t;
use serde_json::json;

use std::rc::Rc;

use crate::screens::approval::{self, is_question};
use crate::ui::space;
use crate::{
    i18n::tn,
    net::types::{MemoriesListSuccess, Memory, MemoryState},
    runtime,
    state::store::{StatusChanged, Store},
    theme::{self},
    ui::{
        button::{Button, Size, Variant},
        face::AgentFace,
        segmented::{self, Segmented},
    },
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Filter {
    All,
    Approvals,
    Questions,
    Memories,
}

pub enum InboxEvent {
    OpenChat(String),
}

impl EventEmitter<InboxEvent> for Inbox {}

pub struct Inbox {
    store: Entity<Store>,
    filter: Filter,
    memories: Vec<Memory>,
    /// An answer box per open question.
    answers: std::collections::HashMap<String, Entity<TextareaState>>,
}

impl Inbox {
    pub fn new(store: Entity<Store>, cx: &mut Context<Self>) -> Self {
        // Approvals come and go with chat statuses: refresh on each change, as the web refetches on its key.
        cx.subscribe(&store, |this, _, _: &StatusChanged, cx| this.refresh(cx))
            .detach();
        cx.observe(&store, |_, _, cx| cx.notify()).detach(); // names and titles
        let mut inbox = Self {
            store,
            filter: Filter::All,
            memories: Vec::new(),
            answers: Default::default(),
        };
        inbox.refresh(cx);
        inbox
    }

    /// Open approvals (from the Store) and proposed memories.
    pub fn count(&self, cx: &App) -> usize {
        self.store.read(cx).needs_you().len() + self.memories.len()
    }

    /// Re-reads the proposed memories (approvals live in the Store, refreshed with every status change).
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            match runtime::spawn(async move { http.get::<MemoriesListSuccess>("/api/memories").await }).await {
                Ok(Ok(memories)) => {
                    let _ = this.update(cx, |this, cx| {
                        this.memories = memories
                            .0
                            .into_iter()
                            .filter(|m| matches!(m.state, MemoryState::Pending))
                            .collect();
                        cx.notify();
                    });
                }
                Ok(Err(e)) => eprintln!("needs you: {e}"),
                Err(e) => eprintln!("needs you: {e}"),
            }
        })
        .detach();
    }

    fn decide(&mut self, id: String, outcome: &'static str, reason: Option<String>, cx: &mut Context<Self>) {
        self.store.update(cx, |store, cx| store.decide(id, outcome, reason, cx));
    }

    fn set_memory(&mut self, id: String, state: &'static str, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        self.memories.retain(|m| m.id != id);
        cx.notify();
        runtime::spawn(async move {
            if let Err(e) = http
                .patch::<_, serde_json::Value>(&format!("/api/memories/{id}"), &json!({ "state": state }))
                .await
            {
                eprintln!("memory: {e}");
            }
        });
    }

    fn answer_box(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) -> Entity<TextareaState> {
        self.answers
            .entry(id.to_string())
            .or_insert_with(|| {
                cx.new(|cx| {
                    let mut state = TextareaState::new(window, cx).placeholder(t!("question.placeholder").into_owned());
                    state.set_auto_grow(2, 6, cx);
                    state
                })
            })
            .clone()
    }
}

impl Render for Inbox {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Inbox {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let approvals = self.store.read(cx).needs_you();
        let questions = approvals.iter().filter(|a| is_question(a)).count();
        let asks = approvals.len() - questions;
        let total = self.count(cx);
        let tabs = [
            (Filter::All, "inbox.all", total),
            (Filter::Approvals, "inbox.approvals", asks),
            (Filter::Questions, "inbox.questions", questions),
            (Filter::Memories, "inbox.memories", self.memories.len()),
        ];
        let show = |f: Filter, filter: Filter| filter == Filter::All || filter == f;
        let filter = self.filter;

        // (at, element), newest first.
        let mut items: Vec<(f64, AnyElement)> = Vec::new();
        for a in approvals {
            let question = is_question(&a);
            if !show(if question { Filter::Questions } else { Filter::Approvals }, filter) {
                continue;
            }
            let answer = question.then(|| self.answer_box(&a.id, window, cx));
            let view = cx.entity().downgrade();
            let decide: approval::Decide = Rc::new(move |id, outcome, reason, _, cx| {
                let _ = view.update(cx, |this, cx| this.decide(id, outcome, reason, cx));
            });
            let view = cx.entity().downgrade();
            let open: approval::OpenChat = Rc::new(move |chat_id, _, cx| {
                let _ = view.update(cx, |_, cx| cx.emit(InboxEvent::OpenChat(chat_id)));
            });
            let card = approval::card(&a, self.store.read(cx), answer.as_ref(), decide, open, window);
            items.push((a.created_at, card.into_any_element()));
        }
        if show(Filter::Memories, filter) {
            for m in self.memories.clone() {
                let agent_scope = m.scope.strip_prefix("agent:");
                let (who, tone) = match agent_scope {
                    Some(agent) => {
                        let store = self.store.read(cx);
                        (store.agent_name(Some(agent)), store.tone(Some(agent)))
                    }
                    None if m.scope == "user" => (t!("inbox.aboutYou").into_owned(), 0),
                    None => (m.scope.clone(), 0),
                };
                let face = AgentFace::new(SharedString::from(format!("mem-face-{}", m.id)), tone)
                    .size(32.)
                    .into_any_element();
                let (discard, keep) = (m.id.clone(), m.id.clone());
                let card = approval::item(
                    p,
                    "memory",
                    (p.bg_control, p.text_secondary),
                    face,
                    who,
                    t!("inbox.proposed").into_owned(),
                )
                .child(div().font_weight(FontWeight::MEDIUM).child(m.title.clone()))
                .child(div().text_color(p.text_secondary).child(m.text.clone()))
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(space::X2))
                        .child(
                            Button::new(
                                SharedString::from(format!("discard-{}", m.id)),
                                t!("inbox.discard").into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(
                                cx.listener(move |this, _, _, cx| this.set_memory(discard.clone(), "forgotten", cx)),
                            ),
                        )
                        // ponytail: "Edit" / "Review the change" open the memory screen, which lands with T055.
                        .when(m.replaces.is_none(), |row| {
                            row.child(
                                Button::new(
                                    SharedString::from(format!("keep-{}", m.id)),
                                    t!("inbox.keep").into_owned(),
                                )
                                .variant(Variant::Primary)
                                .size(Size::Sm)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.set_memory(keep.clone(), "active", cx)),
                                ),
                            )
                        }),
                );
                items.push((m.created_at, card.into_any_element()));
            }
        }
        items.sort_by(|a, b| b.0.total_cmp(&a.0));

        // The prototype's segmented choice (ui/segmented): its marker slides to the filter picked.
        let selected = tabs.iter().position(|(f, _, _)| *f == filter).unwrap_or(0);
        let order: Vec<Filter> = tabs.iter().map(|(f, _, _)| *f).collect();
        let labels = tabs
            .into_iter()
            .map(|(_, key, count)| {
                if count > 0 {
                    format!("{} {count}", t!(key)).into()
                } else {
                    t!(key).into_owned().into()
                }
            })
            .collect();
        let view = cx.entity().downgrade();
        let pick: segmented::OnPick = Rc::new(move |ix, _, cx| {
            let _ = view.update(cx, |this, cx| {
                this.filter = order[ix];
                cx.notify();
            });
        });
        let tab_row = Segmented::new("inbox-filter", t!("inbox.title").into_owned(), labels, selected, pick);
        let subtitle = if total > 0 {
            tn("inbox.waiting", total as i64)
        } else {
            t!("inbox.subtitle").into_owned()
        };
        let empty = items.is_empty();
        div().id("inbox").size_full().overflow_y_scroll().child(
            div()
                .max_w(px(720.))
                .mx_auto()
                .px(px(space::X6))
                .py(px(space::X8))
                .flex()
                .flex_col()
                .gap(px(space::X5))
                .child(
                    div()
                        .flex()
                        .items_end()
                        .justify_between()
                        .child(
                            div()
                                .child(
                                    div()
                                        .text_size(px(22.))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(t!("inbox.title").into_owned()),
                                )
                                .child(div().text_color(p.text_muted).child(subtitle)),
                        )
                        .child(tab_row),
                )
                .when(empty, |c| {
                    c.child(
                        div()
                            .py(px(space::X12))
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(space::X1_5))
                            .child(AgentFace::new("inbox-empty", 0).size(28.))
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(t!("inbox.empty").into_owned()),
                            )
                            .child(div().text_color(p.text_muted).child(t!("inbox.emptyHint").into_owned())),
                    )
                })
                .when(!empty, |c| {
                    c.children(items.into_iter().map(|(_, e)| e)).child(
                        div()
                            .mt(px(space::X3))
                            .text_center()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("inbox.thatsAll").into_owned()),
                    )
                }),
        )
    }
}
