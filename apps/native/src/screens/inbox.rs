// Needs you (spec 019 T034, apps/web/src/features/inbox.tsx): every open approval and question across chats and every
// memory a summary proposed, newest first, filtered by kind. Deciding here is the same as deciding in the chat.
// The list refreshes when a chat's status changes (the Store's StatusChanged), as the web refetches on its key.
// ponytail: a routine's "uncertain" step (spec 013) and editing an "Ask me" step land with the routines screen (T054).
use gpui_kit::{
    base::input::{Textarea, TextareaState},
    component::{
        Sizable as _,
        tab::{Tab, TabBar},
    },
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;
use serde_json::json;

use crate::{
    i18n::tn,
    net::types::{Approval, ApprovalKind, MemoriesListSuccess, Memory, MemoryState},
    runtime,
    state::store::{StatusChanged, Store},
    theme::{self, tokens::Palette},
    ui::{
        button::{Button, Size, Variant},
        code::code_block,
        face::{AgentFace, FaceState},
        layout,
    },
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Filter {
    All,
    Approvals,
    Questions,
    Memories,
}

// A question in words (zorel_ask_user); a routine's "Ask me" step is a yes or no, so it counts as an approval.
fn is_question(a: &Approval) -> bool {
    matches!(a.kind, ApprovalKind::Question) && a.run_step_id.is_none()
}

pub enum InboxEvent {
    OpenChat(String),
}

impl EventEmitter<InboxEvent> for Inbox {}

pub struct Inbox {
    store: Entity<Store>,
    filter: Filter,
    approvals: Vec<Approval>,
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
            approvals: Vec::new(),
            memories: Vec::new(),
            answers: Default::default(),
        };
        inbox.refresh(cx);
        inbox
    }

    pub fn count(&self) -> usize {
        self.approvals.len() + self.memories.len()
    }

    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        let (http, rpc) = (store.http.clone(), store.rpc.clone());
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move {
                let approvals = rpc
                    .call::<Vec<Approval>>("approvals", None)
                    .await
                    .map_err(|e| e.to_string())?;
                let memories: MemoriesListSuccess = http.get("/api/memories").await.map_err(|e| e.to_string())?;
                Ok::<_, String>((approvals, memories))
            })
            .await;
            match got {
                Ok(Ok((approvals, memories))) => {
                    let _ = this.update(cx, |this, cx| {
                        this.approvals = approvals;
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
        let rpc = self.store.read(cx).rpc.clone();
        self.approvals.retain(|a| a.id != id); // the refresh confirms; decided elsewhere, it's gone either way
        cx.notify();
        let mut payload = json!({ "approvalId": id, "outcome": outcome });
        if let Some(reason) = reason.filter(|r| !r.trim().is_empty()) {
            payload["reason"] = json!(reason.trim().chars().take(2000).collect::<String>());
        }
        runtime::spawn(async move {
            if let Err(e) = rpc.call::<serde_json::Value>("decide", Some(payload)).await {
                eprintln!("decide: {e}");
            }
        });
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

/// One card: who, where and when, the kind on the right, the body, then "Open the chat" and the actions.
fn item(p: &Palette, kind: &str, kind_colors: (Rgba, Rgba), face: AnyElement, who: String, context: String) -> Div {
    layout::card(p).flex().flex_col().gap(px(14.)).p(px(20.)).child(
        div()
            .flex()
            .items_start()
            .gap(px(12.))
            .child(face)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().font_weight(FontWeight::SEMIBOLD).truncate().child(who))
                    .child(div().text_sm().text_color(p.text_muted).truncate().child(context)),
            )
            .child(
                div()
                    .flex_none()
                    .rounded_full()
                    .px(px(8.))
                    .py(px(2.))
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .bg(kind_colors.0)
                    .text_color(kind_colors.1)
                    .child(t!(format!("inbox.kind.{kind}")).into_owned()),
            ),
    )
}

impl Render for Inbox {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        let questions = self.approvals.iter().filter(|a| is_question(a)).count();
        let asks = self.approvals.len() - questions;
        let total = self.count();
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
        for a in self.approvals.clone() {
            let question = is_question(&a);
            if !show(if question { Filter::Questions } else { Filter::Approvals }, filter) {
                continue;
            }
            let store = self.store.read(cx);
            let (who, tone) = (
                store.agent_name(a.agent_id.as_deref()),
                store.tone(a.agent_id.as_deref()),
            );
            let context = store.chat(&a.chat_id).map(|c| c.title.clone()).unwrap_or_default();
            let face = AgentFace::new(SharedString::from(format!("inbox-face-{}", a.id)), tone)
                .size(32.)
                .state(FaceState::Waiting)
                .into_any_element();
            let kind = if question { "question" } else { "approval" };
            let colors = if question {
                (p.accent_soft, p.accent_text)
            } else {
                (p.wait_soft, p.warning)
            };
            let mut card = item(p, kind, colors, face, who, context);
            let open = a.chat_id.clone();
            let open_button = Button::new(
                SharedString::from(format!("open-{}", a.id)),
                t!("inbox.openChat").into_owned(),
            )
            .variant(Variant::Ghost)
            .size(Size::Sm)
            .on_click(cx.listener(move |_, _, _, cx| cx.emit(InboxEvent::OpenChat(open.clone()))));
            if question {
                let answer = self.answer_box(&a.id, window, cx);
                let (send_id, skip_id) = (a.id.clone(), a.id.clone());
                let send_box = answer.clone();
                card = card
                    .child(div().text_lg().child(a.summary.clone()))
                    .child(
                        layout::card(p)
                            .bg(p.bg_field)
                            .px(px(10.))
                            .py(px(6.))
                            .child(Textarea::new(&answer)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(open_button)
                            .child(div().flex_1())
                            .child(
                                Button::new(
                                    SharedString::from(format!("skip-{}", a.id)),
                                    t!("question.skip").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.decide(skip_id.clone(), "denied", None, cx)),
                                ),
                            )
                            .child(
                                Button::new(
                                    SharedString::from(format!("send-{}", a.id)),
                                    t!("question.send").into_owned(),
                                )
                                .variant(Variant::Primary)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let text = send_box.read(cx).value().to_string();
                                    this.decide(send_id.clone(), "approved", Some(text), cx)
                                })),
                            ),
                    );
            } else {
                let body = match a.kind {
                    ApprovalKind::Command => code_block(p, a.summary.chars().take(2000).collect::<String>()),
                    _ => div().child(a.summary.clone()).child(
                        div()
                            .mt(px(6.))
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(a.tool.clone()),
                    ),
                };
                let (always, deny, allow) = (a.id.clone(), a.id.clone(), a.id.clone());
                card = card.child(body).child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(open_button)
                        .child(div().flex_1())
                        .when(a.always_key.is_some(), |row| {
                            row.child(
                                Button::new(
                                    SharedString::from(format!("always-{}", a.id)),
                                    t!("approval.allowAlways").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.decide(always.clone(), "always", None, cx)),
                                ),
                            )
                        })
                        .child(
                            Button::new(
                                SharedString::from(format!("deny-{}", a.id)),
                                t!("approval.deny").into_owned(),
                            )
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| this.decide(deny.clone(), "denied", None, cx))),
                        )
                        .child(
                            Button::new(
                                SharedString::from(format!("allow-{}", a.id)),
                                t!("approval.allow").into_owned(),
                            )
                            .variant(Variant::Primary)
                            .size(Size::Sm)
                            .on_click(
                                cx.listener(move |this, _, _, cx| this.decide(allow.clone(), "approved", None, cx)),
                            ),
                        ),
                );
            }
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
                let card = item(
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
                        .gap(px(8.))
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

        // The kit's segmented tabs (themed from styles.css), as the web's Tabs.
        let selected = tabs.iter().position(|(f, _, _)| *f == filter).unwrap_or(0);
        let order: Vec<Filter> = tabs.iter().map(|(f, _, _)| *f).collect();
        let tab_row = TabBar::new("inbox-filter")
            .segmented()
            .small()
            .selected_index(selected)
            .on_click(cx.listener(move |this, ix: &usize, _, cx| {
                this.filter = order[*ix];
                cx.notify();
            }))
            .children(tabs.into_iter().map(|(_, key, count)| {
                let label = if count > 0 {
                    format!("{} {count}", t!(key))
                } else {
                    t!(key).into_owned()
                };
                Tab::new().label(label)
            }));
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
                .px(px(24.))
                .py(px(32.))
                .flex()
                .flex_col()
                .gap(px(20.))
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
                            .py(px(48.))
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(6.))
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
                            .mt(px(12.))
                            .text_center()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("inbox.thatsAll").into_owned()),
                    )
                }),
        )
    }
}
