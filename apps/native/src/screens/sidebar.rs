// The sidebar (spec 019, parity/sidebar.md, prototype parity/prototype/Sidebar.dc.html): the mark and the fold button,
// search, the places, then Projects (each with its chats) and loose Chats, in the web's order: whose turn it is first
// (waiting for you, then working), then chats never placed by hand by latest activity, then the placed ones. Five chats
// per group until "Show more"; the open chat always shows. Folded (⌘B) it is a 56px rail of the places. Its folded
// state, open projects and closed sections are remembered (state/prefs.rs).
// ponytail: row menus (rename, delete), new project, drag to reorder, the foot (usage, pause, settings) and the
// palette arrive in the next steps of this screen (parity/sidebar.md).
use std::collections::{HashMap, HashSet};

use gpui_kit::{
    assets::IconName,
    base::{Spring, spring},
    component::{
        Icon, Sizable as _,
        button::{Button, ButtonVariants as _},
        spinner::Spinner,
    },
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    format,
    i18n::tn,
    labels::{chat_title, status_label},
    net::types::{Chat, ChatStatus, ChatStatusState},
    route::Route,
    state::{prefs::Prefs, store::Store},
    theme::{self, tokens},
    ui::{
        face::{AgentFace, FaceState},
        nav::NavRow,
    },
};

const OPEN_WIDTH: f32 = 268.;
const RAIL_WIDTH: f32 = 56.;
const VISIBLE: usize = 5;
const LOOSE: &str = "chats";

pub enum SidebarEvent {
    Navigate(Route),
}

impl EventEmitter<SidebarEvent> for Sidebar {}

pub struct Sidebar {
    store: Entity<Store>,
    prefs: Prefs,
    /// Groups showing every chat ("chats" or a project id); in memory only, as the web.
    show_all: HashSet<String>,
    pub route: Route,
    /// Needs you: open approvals and proposed memories (from Root).
    pub pending: usize,
}

impl Sidebar {
    pub fn new(store: Entity<Store>, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        Self {
            store,
            prefs: Prefs::load(),
            show_all: HashSet::new(),
            route: Route::default(),
            pending: 0,
        }
    }

    pub fn toggle_folded(&mut self, cx: &mut Context<Self>) {
        self.prefs.sidebar_folded = !self.prefs.sidebar_folded;
        self.prefs.save();
        cx.notify();
    }

    fn toggle_section(&mut self, section: &str, cx: &mut Context<Self>) {
        if !self.prefs.collapsed_sections.remove(section) {
            self.prefs.collapsed_sections.insert(section.to_string());
        }
        self.prefs.save();
        cx.notify();
    }

    fn toggle_project(&mut self, id: &str, cx: &mut Context<Self>) {
        if !self.prefs.expanded_projects.remove(id) {
            self.prefs.expanded_projects.insert(id.to_string());
        }
        self.prefs.save();
        cx.notify();
    }

    fn go(&mut self, route: Route, cx: &mut Context<Self>) {
        cx.emit(SidebarEvent::Navigate(route));
    }
}

/// Waiting for you, then working, then the rest.
fn rank(status: Option<&ChatStatus>) -> u8 {
    match status.map(|s| s.state) {
        Some(ChatStatusState::Waiting) => 0,
        Some(ChatStatusState::Running) => 1,
        _ => 2,
    }
}

fn last_activity(chat: &Chat, status: Option<&ChatStatus>) -> f64 {
    chat.created_at
        .max(chat.last_at.unwrap_or(0.))
        .max(status.map(|s| s.updated_at).unwrap_or(0.))
}

/// One group's chats in sidebar order (apps/web/src/features/sidebar-order.ts).
pub fn ordered<'a>(mut chats: Vec<&'a Chat>, statuses: &HashMap<String, ChatStatus>) -> Vec<&'a Chat> {
    let status = |c: &Chat| statuses.get(&c.id);
    let (mut free, mut placed): (Vec<&Chat>, Vec<&Chat>) = chats.drain(..).partition(|c| c.position.is_none());
    free.sort_by(|a, b| last_activity(b, status(b)).total_cmp(&last_activity(a, status(a))));
    placed.sort_by(|a, b| a.position.unwrap_or(0.).total_cmp(&b.position.unwrap_or(0.)));
    let mut out: Vec<&Chat> = free.into_iter().chain(placed).collect();
    out.sort_by_key(|c| rank(status(c))); // stable: keeps the order above within each rank
    out
}

/// Each chat's status with a task's "waiting for you" lifted onto its parent (the task itself isn't listed).
pub fn lifted(chats: &[Chat], statuses: &HashMap<String, ChatStatus>) -> HashMap<String, ChatStatus> {
    let mut out = statuses.clone();
    for child in chats.iter().filter(|c| c.parent_id.is_some()) {
        let waiting = statuses
            .get(&child.id)
            .is_some_and(|s| s.state == ChatStatusState::Waiting);
        if let (true, Some(parent)) = (waiting, &child.parent_id)
            && let Some(child_status) = statuses.get(&child.id)
        {
            let entry = out.entry(parent.clone()).or_insert_with(|| child_status.clone());
            if entry.state != ChatStatusState::Waiting {
                *entry = ChatStatus {
                    chat_id: parent.clone(),
                    ..child_status.clone()
                };
            }
        }
    }
    out
}

pub fn face_state(status: Option<&ChatStatus>) -> FaceState {
    match status.map(|s| s.state) {
        Some(ChatStatusState::Running) => FaceState::Working,
        Some(ChatStatusState::Waiting) => FaceState::Waiting,
        Some(ChatStatusState::Failed) => FaceState::Failed,
        _ => FaceState::Idle,
    }
}

/// What every row reads: the store and each chat's (lifted) status.
struct Lists<'a> {
    store: &'a Store,
    statuses: &'a HashMap<String, ChatStatus>,
}

impl Sidebar {
    fn chat_row(
        &self,
        chat: &Chat,
        status: Option<&ChatStatus>,
        nested: bool,
        store: &Store,
        window: &Window,
        cx: &Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let state = face_state(status);
        let live = state != FaceState::Idle;
        let lead = chat.agent_ids.first().map(String::as_str);
        let leading: AnyElement = if live {
            AgentFace::new(SharedString::from(format!("side-face-{}", chat.id)), store.tone(lead))
                .size(20.)
                .state(state)
                .into_any_element()
        } else if nested {
            div().size(px(20.)).into_any_element()
        } else {
            Icon::new(IconName::MessageCircle)
                .small()
                .text_color(p.text_muted)
                .into_any_element()
        };
        let detail = status.map(|s| status_label(s, store)).filter(|d| !d.is_empty());
        let tone = match state {
            FaceState::Waiting => Some(p.warning),
            FaceState::Failed => Some(p.danger),
            _ => None,
        };
        let at = chat
            .last_at
            .unwrap_or(chat.created_at)
            .max(status.map(|s| s.updated_at).unwrap_or(0.));
        let age = format::age(at, format::now_ms(), format::lang());
        let id = chat.id.clone();
        let active = self.route == (Route::Chat { id: id.clone() });
        NavRow::new(SharedString::from(format!("chat-{}", chat.id)), chat_title(chat))
            .leading(leading)
            .when_some(detail, |r, d| r.detail(d, tone))
            .trailing(div().text_xs().text_color(p.text_dim).child(age))
            .indent(if nested { 18. } else { 0. })
            .active(active)
            .emphasis(state == FaceState::Waiting)
            .on_click(cx.listener(move |this, _, _, cx| this.go(Route::Chat { id: id.clone() }, cx)))
            .into_any_element()
    }

    /// A group's rows: the first five plus the open chat, then "Show N more" / "Show less".
    fn group_rows(
        &self,
        key: &str,
        chats: Vec<&Chat>,
        lists: &Lists,
        nested: bool,
        window: &Window,
        cx: &Context<Self>,
    ) -> Vec<AnyElement> {
        let (store, statuses) = (lists.store, lists.statuses);
        let all = self.show_all.contains(key);
        let open = match &self.route {
            Route::Chat { id } => Some(id.clone()),
            _ => None,
        };
        let total = chats.len();
        let visible: Vec<&Chat> = chats
            .into_iter()
            .enumerate()
            .filter(|(i, c)| all || *i < VISIBLE || Some(&c.id) == open.as_ref())
            .map(|(_, c)| c)
            .collect();
        let hidden = total - visible.len();
        let mut rows: Vec<AnyElement> = visible
            .into_iter()
            .map(|c| self.chat_row(c, statuses.get(&c.id), nested, store, window, cx))
            .collect();
        if total > VISIBLE {
            let label = if all {
                t!("nav.showLess").into_owned()
            } else {
                tn("nav.showMore", hidden as i64)
            };
            let key = key.to_string();
            let p = theme::palette(window);
            rows.push(
                NavRow::new(SharedString::from(format!("more-{key}")), label)
                    .leading(div().size(px(20.)))
                    .indent(if nested { 18. } else { 0. })
                    .trailing(div().text_color(p.text_dim))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.show_all.remove(&key) {
                            this.show_all.insert(key.clone());
                        }
                        cx.notify();
                    }))
                    .into_any_element(),
            );
        }
        rows
    }

    /// A section's label row: name, a summary while closed (how many wait), and its "+".
    fn section(
        &self,
        key: &'static str,
        label: String,
        waiting: usize,
        add: Option<AnyElement>,
        window: &Window,
        cx: &Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let closed = self.prefs.collapsed_sections.contains(key);
        div()
            .id(SharedString::from(format!("section-{key}")))
            .flex()
            .items_end()
            .gap(px(6.))
            .h(px(28.))
            .pl(px(10.))
            .pr(px(6.))
            .pb(px(6.))
            .mt(px(8.))
            .text_size(px(11.5))
            .font_weight(FontWeight::MEDIUM)
            .text_color(p.text_muted)
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_section(key, cx)))
            .child(div().flex_1().child(label))
            .when(closed && waiting > 0, |r| {
                r.child(div().text_color(p.warning).child(tn("nav.waitingIn", waiting as i64)))
            })
            .child(
                Icon::new(if closed {
                    IconName::ChevronRight
                } else {
                    IconName::ChevronDown
                })
                .xsmall()
                .text_color(p.text_dim),
            )
            .when_some(add, |r, a| r.child(a))
            .into_any_element()
    }
}

impl Render for Sidebar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        let folded = self.prefs.sidebar_folded;
        let width = spring(
            "sidebar-width",
            px(if folded { RAIL_WIDTH } else { OPEN_WIDTH }),
            Spring::new(std::time::Duration::from_millis(220)).with_damping(1.),
            window,
            cx,
        );
        let cx: &Context<Self> = cx; // from here on only listeners and reads
        let store_entity = self.store.clone();
        let store = store_entity.read(cx);
        let statuses = lifted(&store.chats.chats, &store.chats.statuses);
        let place =
            |this: &Self, id: &'static str, icon: IconName, label: String, route: Option<Route>, cx: &Context<Self>| {
                let active = route.as_ref().is_some_and(|r| *r == this.route);
                let row = NavRow::new(id, label)
                    .icon(icon)
                    .rail(folded)
                    .active(active)
                    .disabled(route.is_none());
                match route {
                    Some(route) => row.on_click(cx.listener(move |this, _, _, cx| this.go(route.clone(), cx))),
                    None => row, // ponytail: Agents, Routines and Memory open once their screens exist
                }
            };
        let pending = self.pending;
        let inbox = place(
            self,
            "nav-inbox",
            IconName::Inbox,
            t!("nav.needsYou").into_owned(),
            Some(Route::Inbox),
            cx,
        )
        .when(pending > 0, |r| {
            r.trailing(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(p.warning)
                    .child(div().size(px(6.)).rounded_full().bg(p.warning))
                    .child(pending.to_string()),
            )
        });
        let places = vec![
            place(
                self,
                "nav-home",
                IconName::House,
                t!("nav.homeScreen").into_owned(),
                Some(Route::Home { project_id: None }),
                cx,
            )
            .into_any_element(),
            inbox.into_any_element(),
            place(
                self,
                "nav-agents",
                IconName::Bot,
                t!("nav.agents").into_owned(),
                None,
                cx,
            )
            .into_any_element(),
            place(
                self,
                "nav-routines",
                IconName::AlarmClock,
                t!("nav.routines").into_owned(),
                None,
                cx,
            )
            .into_any_element(),
            place(
                self,
                "nav-memory",
                IconName::Brain,
                t!("nav.memory").into_owned(),
                None,
                cx,
            )
            .into_any_element(),
        ];

        let mut list: Vec<AnyElement> = Vec::new();
        if !folded {
            // Projects, each with its chats.
            let projects_waiting = store
                .projects
                .iter()
                .map(|pr| {
                    store
                        .chats
                        .chats
                        .iter()
                        .filter(|c| {
                            c.project_id.as_deref() == Some(&pr.id)
                                && c.parent_id.is_none()
                                && statuses.get(&c.id).is_some_and(|s| s.state == ChatStatusState::Waiting)
                        })
                        .count()
                })
                .sum();
            list.push(self.section(
                "projects",
                t!("nav.projects").into_owned(),
                projects_waiting,
                None,
                window,
                cx,
            ));
            if !self.prefs.collapsed_sections.contains("projects") {
                if store.projects.is_empty() {
                    list.push(
                        div()
                            .px(px(10.))
                            .py(px(6.))
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("nav.emptyProjects").into_owned())
                            .into_any_element(),
                    );
                }
                for project in &store.projects {
                    let chats: Vec<&Chat> = store
                        .chats
                        .chats
                        .iter()
                        .filter(|c| c.project_id.as_deref() == Some(&project.id) && c.parent_id.is_none())
                        .collect();
                    let waiting = chats
                        .iter()
                        .filter(|c| statuses.get(&c.id).is_some_and(|s| s.state == ChatStatusState::Waiting))
                        .count();
                    let running = chats
                        .iter()
                        .filter(|c| statuses.get(&c.id).is_some_and(|s| s.state == ChatStatusState::Running))
                        .count();
                    let open_here = matches!(&self.route, Route::Chat { id } if chats.iter().any(|c| &c.id == id))
                        || self.route
                            == (Route::Home {
                                project_id: Some(project.id.clone()),
                            });
                    let expanded = open_here || self.prefs.expanded_projects.contains(&project.id);
                    let trailing: AnyElement = match (waiting, running) {
                        (w, _) if w > 0 => div()
                            .text_xs()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(p.warning)
                            .child(w.to_string())
                            .into_any_element(),
                        (_, r) if r > 0 => Spinner::new().xsmall().into_any_element(),
                        _ => div()
                            .text_xs()
                            .text_color(p.text_dim)
                            .child(chats.len().to_string())
                            .into_any_element(),
                    };
                    let (toggle, new_in) = (project.id.clone(), project.id.clone());
                    list.push(
                        NavRow::new(
                            SharedString::from(format!("project-{}", project.id)),
                            project.name.clone(),
                        )
                        .icon(if expanded {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        })
                        .active(
                            self.route
                                == (Route::Home {
                                    project_id: Some(project.id.clone()),
                                }),
                        )
                        .trailing(trailing)
                        .on_hover_trailing(
                            Button::new(SharedString::from(format!("new-in-{}", project.id)))
                                .ghost()
                                .xsmall()
                                .icon(IconName::Plus)
                                .tooltip(t!("nav.newChatIn", name = project.name).into_owned())
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.go(
                                        Route::Home {
                                            project_id: Some(new_in.clone()),
                                        },
                                        cx,
                                    )
                                })),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| this.toggle_project(&toggle, cx)))
                        .into_any_element(),
                    );
                    if expanded {
                        if chats.is_empty() {
                            let start = project.id.clone();
                            list.push(
                                NavRow::new(
                                    SharedString::from(format!("start-{}", project.id)),
                                    t!("nav.emptyProjectStart").into_owned(),
                                )
                                .leading(div().size(px(20.)))
                                .indent(18.)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.go(
                                        Route::Home {
                                            project_id: Some(start.clone()),
                                        },
                                        cx,
                                    )
                                }))
                                .into_any_element(),
                            );
                        }
                        let rows = self.group_rows(
                            &project.id,
                            ordered(chats, &statuses),
                            &Lists {
                                store,
                                statuses: &statuses,
                            },
                            true,
                            window,
                            cx,
                        );
                        list.extend(rows);
                    }
                }
            }
            // Chats outside any project.
            let loose: Vec<&Chat> = store
                .chats
                .chats
                .iter()
                .filter(|c| c.project_id.is_none() && c.parent_id.is_none())
                .collect();
            let loose_waiting = loose
                .iter()
                .filter(|c| statuses.get(&c.id).is_some_and(|s| s.state == ChatStatusState::Waiting))
                .count();
            let add = Button::new("new-chat")
                .ghost()
                .xsmall()
                .icon(IconName::Plus)
                .tooltip(t!("nav.newChat").into_owned())
                .on_click(cx.listener(|this, _, _, cx| this.go(Route::Home { project_id: None }, cx)))
                .into_any_element();
            list.push(self.section(
                LOOSE,
                t!("nav.chats").into_owned(),
                loose_waiting,
                Some(add),
                window,
                cx,
            ));
            if !self.prefs.collapsed_sections.contains(LOOSE) {
                if loose.is_empty() {
                    list.push(
                        div()
                            .px(px(10.))
                            .py(px(6.))
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("nav.noChats").into_owned())
                            .into_any_element(),
                    );
                }
                let rows = self.group_rows(
                    LOOSE,
                    ordered(loose, &statuses),
                    &Lists {
                        store,
                        statuses: &statuses,
                    },
                    false,
                    window,
                    cx,
                );
                list.extend(rows);
            }
        }

        let fold = Button::new("fold")
            .ghost()
            .small()
            .icon(if folded {
                IconName::PanelLeftOpen
            } else {
                IconName::PanelLeftClose
            })
            .tooltip(if folded {
                t!("nav.showSidebar").into_owned()
            } else {
                t!("nav.hideSidebar").into_owned()
            })
            .on_click(cx.listener(|this, _, _, cx| this.toggle_folded(cx)));
        let search = div()
            .id("search")
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(32.))
            .px(px(10.))
            .rounded(px(tokens::RADIUS_CONTROL))
            .bg(p.bg_control)
            .text_color(p.text_muted)
            .child(Icon::new(IconName::Search).small())
            .when(!folded, |s| {
                s.child(div().flex_1().truncate().child(t!("nav.searchOrGo").into_owned()))
                    .child(
                        div()
                            .px(px(5.))
                            .h(px(18.))
                            .flex()
                            .items_center()
                            .rounded(px(5.))
                            .border_1()
                            .border_color(p.border_strong)
                            .text_size(px(10.5))
                            .child(if cfg!(target_os = "macos") { "⌘K" } else { "Ctrl K" }),
                    )
            });

        div()
            .w(width)
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .gap(px(16.))
            .py(px(8.))
            .px(px(if folded { 8. } else { 12. }))
            .pt(px(36.)) // the window's traffic lights
            .bg(p.bg_sidebar)
            .text_color(p.text_secondary)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .h(px(36.))
                    .when(!folded, |h| h.pl(px(12.)))
                    .when(!folded, |h| {
                        h.child(svg().path(crate::assets::LOGO).size(px(20.)).text_color(p.text))
                            .child(
                                div()
                                    .flex_1()
                                    .text_size(px(15.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(p.text)
                                    .child(t!("app.name").into_owned()),
                            )
                    })
                    .child(fold),
            )
            .child(search)
            .child(div().flex().flex_col().gap(px(1.)).children(places))
            .when(!folded, |c| {
                c.child(
                    div()
                        .id("sidebar-list")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .children(list),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{lifted, ordered};
    use crate::net::types::{Chat, ChatStatus, ChatStatusState};

    fn chat(id: &str, created: f64, position: Option<f64>, parent: Option<&str>) -> Chat {
        serde_json::from_value(
            serde_json::json!({ "id": id, "title": id, "createdAt": created, "position": position,
            "lastAt": null, "parentId": parent, "projectId": null, "agentIds": [], "model": "a/b", "accountId": null,
            "effort": null, "access": null, "failover": null, "agentWorktrees": {}, "learnedUntil": 0, "preview": null,
            "resumeAt": null, "summary": "", "summaryUntil": 0, "worktree": null }),
        )
        .expect("a chat")
    }

    fn status(chat: &str, state: &str) -> ChatStatus {
        serde_json::from_value(
            serde_json::json!({ "chatId": chat, "state": state, "label": "", "unread": false,
            "updatedAt": 0, "agentId": null, "agentIds": [], "waits": [] }),
        )
        .expect("a status")
    }

    #[test]
    fn whose_turn_first_then_recent_then_placed() {
        let chats = [
            chat("old", 1., None, None),
            chat("new", 5., None, None),
            chat("pinned", 0., Some(1.), None),
            chat("asks", 0., None, None),
        ];
        let statuses = HashMap::from([("asks".to_string(), status("asks", "waiting"))]);
        let ids: Vec<&str> = ordered(chats.iter().collect(), &statuses)
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, ["asks", "new", "old", "pinned"]);
    }

    #[test]
    fn a_task_waiting_lifts_onto_its_parent() {
        let chats = [chat("parent", 1., None, None), chat("task", 2., None, Some("parent"))];
        let statuses = HashMap::from([("task".to_string(), status("task", "waiting"))]);
        assert_eq!(lifted(&chats, &statuses)["parent"].state, ChatStatusState::Waiting);
    }
}
