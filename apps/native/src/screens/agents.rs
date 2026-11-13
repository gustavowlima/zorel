// The agents (apps/web/src/features/agents.tsx): every teammate, global ones first and then each project's, with its
// face (working, waiting), what it does and its model; a row opens a new chat with it, its ⋯ archives, restores or
// deletes it (never the last one: every chat needs an agent). "New agent" builds one with AI (the Builder);
// archived agents fold away at the end.
// ponytail: the agent's own page (profile, powers, memory, work) and "Build it myself" come with the agent page.
use std::rc::Rc;

use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};
use rust_i18n::t;

use crate::{
    labels::{model_name, provider_label, split_model},
    net::types::{Agent, ChatStatusState},
    route::Route,
    state::store::Store,
    theme,
    ui::{
        button::{Button, Size, Variant},
        face::{AgentFace, FaceState},
        layout,
        menu::{self, Menu},
        nav::NavRow,
        space,
    },
};

pub enum AgentsEvent {
    Navigate(Route),
    /// Start a chat with this agent (Home, the agent chosen).
    ChatWith(String),
}

impl EventEmitter<AgentsEvent> for Agents {}

pub struct Agents {
    store: Entity<Store>,
    show_archived: bool,
}

impl Agents {
    pub fn new(store: Entity<Store>, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        Self {
            store,
            show_archived: false,
        }
    }

    /// Archives or restores an agent (it keeps its history; archived, it answers no one and runs no routine).
    pub(crate) fn archive(store: &Entity<Store>, id: String, archived: bool, cx: &mut App) {
        // Moves at once; the reload after the engine answers corrects it.
        store.update(cx, |s, cx| {
            if let Some(a) = s.agents.iter_mut().find(|a| a.id == id) {
                a.archived_at = archived.then(crate::format::now_ms);
            }
            cx.notify();
        });
        store.update(cx, |s, cx| {
            let body = serde_json::json!({ "archived": archived });
            s.write(
                crate::state::store::Method::Patch,
                format!("/api/agents/{id}"),
                body,
                cx,
            )
            .detach()
        });
    }

    pub(crate) fn delete(store: &Entity<Store>, agent: &Agent, window: &mut Window, cx: &mut App) {
        use gpui_kit::component::WindowExt as _;
        let (store, id, name) = (store.clone(), agent.id.clone(), agent.name.clone());
        window.open_dialog(cx, move |dialog, window, _| {
            let (store, id) = (store.clone(), id.clone());
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("agent.deleteTitle", name = name).into_owned(),
                    description: Some(t!("agent.deleteBody").into_owned()),
                    body: None,
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("delete", t!("agent.deleteAction").into_owned())
                            .variant(Variant::Destructive)
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                store.update(cx, |s, cx| {
                                    s.agents.retain(|a| a.id != id);
                                    cx.notify();
                                });
                                store.update(cx, |s, cx| {
                                    let path = format!("/api/agents/{id}");
                                    s.write(crate::state::store::Method::Delete, path, serde_json::Value::Null, cx)
                                        .detach()
                                });
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }

    fn row(&self, agent: &Agent, last: bool, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        // Working now: the chat its status belongs to.
        let status = store
            .chats
            .statuses
            .values()
            .find(|s| s.agent_id.as_deref() == Some(&agent.id) && !matches!(s.state, ChatStatusState::Idle));
        let state = match status.map(|s| s.state) {
            Some(ChatStatusState::Running) => FaceState::Working,
            Some(ChatStatusState::Waiting) => FaceState::Waiting,
            Some(ChatStatusState::Failed) => FaceState::Failed,
            _ => FaceState::Idle,
        };
        let line = status
            .map(|s| s.label.clone())
            .filter(|l| !l.is_empty())
            .or_else(|| (!agent.title.is_empty()).then(|| agent.title.clone()))
            .or_else(|| (!agent.description.is_empty()).then(|| agent.description.clone()))
            .unwrap_or_else(|| agent.instructions.lines().next().unwrap_or_default().to_string());
        let (provider, _) = split_model(&agent.model);
        let model = format!(
            "{} · {}",
            provider_label(provider),
            model_name(&agent.model, &store.models)
        );
        let face = AgentFace::new(
            SharedString::from(format!("agents-face-{}", agent.id)),
            store.tone(Some(&agent.id)),
        )
        .size(28.)
        .state(state);
        // ⋯ and right-click: archive or restore, delete. The only agent has neither (every chat needs one): no menu
        // that only says why it can't.
        let (store_a, store_d, a2) = (self.store.clone(), self.store.clone(), agent.clone());
        let (id, archived) = (agent.id.clone(), agent.archived_at.is_some());
        let items: menu::Items = Rc::new(move || {
            let (store_a, store_d, id, a2) = (store_a.clone(), store_d.clone(), id.clone(), a2.clone());
            Menu::default()
                .item(
                    if archived {
                        t!("agent.restoreArchived")
                    } else {
                        t!("agent.archive")
                    }
                    .into_owned(),
                    move |_, cx| Self::archive(&store_a, id.clone(), !archived, cx),
                )
                .separator()
                .danger(t!("agent.deleteAction").into_owned(), move |window, cx| {
                    Self::delete(&store_d, &a2, window, cx)
                })
                .build()
        });
        let more = menu::dropdown(
            SharedString::from(format!("agent-more-{}", agent.id)),
            Button::icon_only(
                SharedString::from(format!("agent-more-btn-{}", agent.id)),
                IconName::Ellipsis,
                t!("agents.actions", name = agent.name).into_owned(),
            )
            .size(Size::Sm),
            items.clone(),
        );
        let id = agent.id.clone();
        NavRow::new(
            SharedString::from(format!("agent-row-{}", agent.id)),
            agent.name.clone(),
        )
        .leading(face)
        .detail(line, (state == FaceState::Waiting).then_some(p.warning))
        .emphasis(true)
        .when(!last, |r| r.menu(items).on_hover_trailing(more))
        .trailing(div().text_sm().text_color(p.text_muted).child(model))
        // The row opens its page (Work: what it does, Talk with it).
        .on_click(cx.listener(move |_, _, _, cx| cx.emit(AgentsEvent::Navigate(Route::Agent { id: id.clone() }))))
        .into_any_element()
    }
}

impl Render for Agents {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Agents {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let team: Vec<Agent> = store
            .agents
            .iter()
            .filter(|a| a.builtin.is_none() && a.archived_at.is_none())
            .cloned()
            .collect();
        let archived: Vec<Agent> = store
            .agents
            .iter()
            .filter(|a| a.builtin.is_none() && a.archived_at.is_some())
            .cloned()
            .collect();
        let groups: Vec<(Option<String>, String, Option<String>)> = std::iter::once((
            None,
            t!("agents.global").into_owned(),
            Some(t!("agents.globalHint").into_owned()),
        ))
        .chain(
            store
                .projects
                .iter()
                .map(|pr| (Some(pr.id.clone()), pr.name.clone(), None)),
        )
        .collect();
        let last = team.len() == 1;
        let mut sections: Vec<AnyElement> = Vec::new();
        for (project, name, hint) in groups {
            let list: Vec<&Agent> = team.iter().filter(|a| a.project_id == project).collect();
            if list.is_empty() {
                continue;
            }
            let rows: Vec<AnyElement> = list.iter().map(|a| self.row(a, last, window, cx)).collect();
            let new_in = project.clone();
            let add = project.is_some().then(|| {
                Button::icon_only(
                    SharedString::from(format!("agents-new-{}", new_in.clone().unwrap_or_default())),
                    IconName::Plus,
                    t!("agents.withAi").into_owned(),
                )
                .size(Size::Sm)
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.emit(AgentsEvent::Navigate(Route::Builder {
                        project_id: new_in.clone(),
                    }))
                }))
                .into_any_element()
            });
            sections.push(
                layout::section(
                    p,
                    format!("{name} · {}", list.len()),
                    hint,
                    add,
                    layout::rows(p).children(rows),
                )
                .into_any_element(),
            );
        }
        if !archived.is_empty() {
            let open = self.show_archived;
            let toggle = Button::new(
                "agents-archived-toggle",
                if open {
                    t!("agents.hideArchived")
                } else {
                    t!("agents.showArchived")
                }
                .into_owned(),
            )
            .variant(Variant::Ghost)
            .size(Size::Sm)
            .on_click(cx.listener(|this, _, _, cx| {
                this.show_archived = !this.show_archived;
                cx.notify();
            }))
            .into_any_element();
            let rows: Vec<AnyElement> = if open {
                archived.iter().map(|a| self.row(a, false, window, cx)).collect()
            } else {
                Vec::new()
            };
            let has_rows = !rows.is_empty();
            sections.push(
                layout::section(
                    p,
                    format!("{} · {}", t!("agents.archived"), archived.len()),
                    Some(t!("agents.archivedHint").into_owned()),
                    Some(toggle),
                    div().when(has_rows, |d| d.child(layout::rows(p).children(rows))),
                )
                .into_any_element(),
            );
        }
        let empty = team.is_empty();
        div().id("agents").size_full().overflow_y_scroll().child(
            div()
                .w_full()
                .max_w(px(720.))
                .mx_auto()
                .px(px(space::X6))
                .py(px(space::X6))
                .flex()
                .flex_col()
                .gap(px(space::X7))
                .when(empty, |c| {
                    c.child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(space::X2))
                            .py(px(space::X12))
                            .child(AgentFace::new("agents-empty", 0).size(40.))
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(t!("agents.empty").into_owned()),
                            )
                            .child(
                                div()
                                    .max_w(px(360.))
                                    .text_center()
                                    .text_color(p.text_muted)
                                    .child(t!("agents.emptyHint").into_owned()),
                            ),
                    )
                })
                .children(sections),
        )
    }
}
