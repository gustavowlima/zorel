// The sidebar (spec 019, parity/sidebar.md, prototype parity/prototype/Sidebar.dc.html): the mark and the fold button,
// search, the places, then Projects (each with its chats) and loose Chats, in the web's order: whose turn it is first
// (waiting for you, then working), then chats never placed by hand by latest activity, then the placed ones. Five chats
// per group until "Show more"; the open chat always shows. Folded (⌘B) it is a 56px rail of the places. Its folded
// state, open projects and closed sections are remembered (state/prefs.rs).
// ponytail: row menus (rename, delete), new project, drag to reorder, the foot (usage, pause, settings) and the
// palette arrive in the next steps of this screen (parity/sidebar.md).
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

use gpui_kit::{assets::IconName, base::spring, prelude::FluentBuilder, *};
use rust_i18n::t;

use crate::ui::button::{Button, Size};
use crate::ui::icon::{self, icon};
use crate::ui::{motion, space};

use crate::{
    format,
    i18n::tn,
    labels::{chat_title, status_label},
    net::types::{Chat, ChatStatus, ChatStatusState},
    route::Route,
    state::{prefs::Prefs, store::Store},
    theme::{self, tokens},
    ui::{
        face::{AgentFace, FaceState, WorkingRing},
        nav::{DragRow, NavRow, OnReorder, moved_before},
    },
};

const OPEN_WIDTH: f32 = 268.;
const RAIL_WIDTH: f32 = 56.; // RAIL_ITEM + 2 × space::X2_5
/// Every item on the folded rail is this square (fold, search, places, foot), centred: 10px each side.
const RAIL_ITEM: f32 = tokens::CONTROL_H_LG;
const VISIBLE: usize = 5;
const LOOSE: &str = "chats";

pub enum SidebarEvent {
    Navigate(Route),
    /// The search bar: open the palette.
    Palette,
}

impl EventEmitter<SidebarEvent> for Sidebar {}

pub struct Sidebar {
    pub(super) store: Entity<Store>,
    prefs: Prefs,
    /// Heights of what opens and closes (sections, projects), for their animation.
    collapse: crate::ui::collapse::Measured,
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
            collapse: Default::default(),
            show_all: HashSet::new(),
            route: Route::default(),
            pending: 0,
        }
    }

    /// Whether it is the narrow rail (the window's title strip then clears the traffic lights itself).
    pub fn folded(&self) -> bool {
        self.prefs.sidebar_folded
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

impl Sidebar {
    // PUT the group's new order after a drop: a project's chats, or the loose ones (projectId null).
    fn chat_reorder(&self, key: &str, order: Vec<String>) -> OnReorder {
        let store = self.store.downgrade();
        let project = (key != LOOSE).then(|| key.to_string());
        Rc::new(move |dragged: &DragRow, target: &DragRow, _, cx: &mut App| {
            let ids = moved_before(&order, &dragged.id, &target.id);
            let body = serde_json::json!({ "projectId": project, "ids": ids });
            Self::put_order(&store, "/api/chats/order", body, cx);
        })
    }

    fn project_reorder(&self, order: Vec<String>) -> OnReorder {
        let store = self.store.downgrade();
        Rc::new(move |dragged: &DragRow, target: &DragRow, _, cx: &mut App| {
            let ids = moved_before(&order, &dragged.id, &target.id);
            Self::put_order(&store, "/api/projects/order", serde_json::json!({ "ids": ids }), cx);
        })
    }

    fn put_order(store: &WeakEntity<Store>, path: &'static str, body: serde_json::Value, cx: &mut App) {
        let Some(http) = store.upgrade().map(|s| s.read(cx).http.clone()) else {
            return;
        };
        let store = store.clone();
        cx.spawn(async move |cx| {
            if let Ok(Err(e)) =
                crate::runtime::spawn(async move { http.put::<_, serde_json::Value>(path, &body).await }).await
            {
                eprintln!("reorder: {e}");
            }
            let _ = store.update(cx, |store, cx| store.load(cx));
        })
        .detach();
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
    ) -> NavRow {
        let p = theme::palette(window);
        let state = face_state(status);
        // Always the face of the agent who worked last (the status's, else the lead); a chat that never had one
        // keeps the default mark.
        let last = status
            .and_then(|s| s.agent_id.as_deref())
            .or(chat.agent_ids.first().map(String::as_str));
        let leading: AnyElement = match last {
            Some(agent) => AgentFace::new(
                SharedString::from(format!("side-face-{}", chat.id)),
                store.tone(Some(agent)),
            )
            .size(20.)
            .state(state)
            .into_any_element(),
            None => icon(IconName::MessageCircle, icon::MD)
                .text_color(p.text_muted)
                .into_any_element(),
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
        let menu = Self::chat_menu(&cx.entity(), chat.id.clone(), chat.title.clone());
        let more = more_button(format!("chat-more-{}", chat.id), chat_title(chat), menu.clone());
        NavRow::new(SharedString::from(format!("chat-{}", chat.id)), chat_title(chat))
            .menu(menu)
            .on_hover_trailing(more)
            .leading(leading)
            .when_some(detail, |r, d| r.detail(d, tone))
            .trailing(div().text_xs().text_color(p.text_dim).child(age))
            .indent(if nested { space::X3 } else { 0. })
            .active(active)
            .emphasis(state == FaceState::Waiting)
            .on_click(cx.listener(move |this, _, _, cx| this.go(Route::Chat { id: id.clone() }, cx)))
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
        let order: Vec<String> = chats.iter().map(|c| c.id.clone()).collect();
        let visible: Vec<&Chat> = chats
            .into_iter()
            .enumerate()
            .filter(|(i, c)| all || *i < VISIBLE || Some(&c.id) == open.as_ref())
            .map(|(_, c)| c)
            .collect();
        let hidden = total - visible.len();
        // Drag to reorder within this group: the whole group's new order goes to the engine.
        let reorder = self.chat_reorder(key, order);
        let mut rows: Vec<AnyElement> = visible
            .into_iter()
            .map(|c| {
                let drag = DragRow {
                    group: key.to_string().into(),
                    id: c.id.clone().into(),
                    label: chat_title(c).into(),
                };
                self.chat_row(c, statuses.get(&c.id), nested, store, window, cx)
                    .reorder(drag, reorder.clone())
                    .into_any_element()
            })
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
                    .indent(if nested { space::X3 } else { 0. })
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
        (label, waiting): (String, usize),
        add: Option<AnyElement>,
        turn: Pixels,
        window: &Window,
        cx: &Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let closed = self.prefs.collapsed_sections.contains(key);
        div()
            .id(SharedString::from(format!("section-{key}")))
            .flex()
            .items_center()
            .gap(px(space::X0_5))
            .h(px(tokens::CONTROL_H))
            .pl(px(space::X2_5))
            .pr(px(space::X1))
            .mt(px(space::X2))
            .text_size(px(11.5))
            .font_weight(FontWeight::MEDIUM)
            .text_color(p.text_muted)
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_section(key, cx)))
            .child(div().flex_1().child(label))
            .when(closed && waiting > 0, |r| {
                r.child(
                    div()
                        .mr(px(space::X1))
                        .text_color(p.warning)
                        .child(tn("nav.waitingIn", waiting as i64)),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(tokens::CONTROL_H_XS))
                    .child(
                        icon(IconName::ChevronDown, icon::XS)
                            .text_color(p.text_dim)
                            .rotate(radians(f32::from(turn).to_radians())),
                    ),
            )
            .when_some(add, |r, a| r.child(a))
            .into_any_element()
    }
}

impl Render for Sidebar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Sidebar {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let folded = self.prefs.sidebar_folded;
        let width = spring(
            "sidebar-width",
            px(if folded { RAIL_WIDTH } else { OPEN_WIDTH }),
            motion::settle(motion::SETTLE_MS),
            window,
            cx,
        );
        // Each section's chevron turns on a spring (down = open).
        let mut turn = |key: &'static str| {
            let closed = self.prefs.collapsed_sections.contains(key);
            spring(
                SharedString::from(format!("section-turn-{key}")),
                px(if closed { -90. } else { 0. }),
                motion::settle(motion::SETTLE_MS),
                window,
                cx,
            )
        };
        let (projects_turn, loose_turn) = (turn("projects"), turn(LOOSE));
        // What opens and closes springs its height; a project's chevron turns.
        let mut heights: HashMap<String, Option<(Pixels, f32)>> = HashMap::new();
        let mut project_turns: HashMap<String, Pixels> = HashMap::new();
        for key in ["projects", LOOSE] {
            let open = !self.prefs.collapsed_sections.contains(key);
            heights.insert(key.to_string(), self.collapse.height(key, open, window, cx));
        }
        {
            let route = self.route.clone();
            let store = self.store.read(cx);
            let projects: Vec<(String, bool)> = store
                .projects
                .iter()
                .map(|pr| {
                    let here = matches!(&route, Route::Chat { id } if store.chat(id).and_then(|c| c.project_id.as_deref()) == Some(pr.id.as_str()))
                        || route == (Route::Home { project_id: Some(pr.id.clone()) });
                    (pr.id.clone(), here || self.prefs.expanded_projects.contains(&pr.id))
                })
                .collect();
            for (id, open) in projects {
                let key = format!("project:{id}");
                heights.insert(key.clone(), self.collapse.height(&key, open, window, cx));
                project_turns.insert(
                    id.clone(),
                    spring(
                        SharedString::from(format!("project-turn-{id}")),
                        px(if open { 0. } else { -90. }),
                        motion::settle(motion::SETTLE_MS),
                        window,
                        cx,
                    ),
                );
            }
        }
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
                    .gap(px(space::X1_5))
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
            let view = cx.entity();
            let add_project = Button::icon_only("new-project", IconName::Plus, t!("nav.newProject").into_owned())
                .size(Size::Xs)
                .on_click(move |_, window, cx| Self::new_project(&view, window, cx))
                .into_any_element();
            list.push(self.section(
                "projects",
                (t!("nav.projects").into_owned(), projects_waiting),
                Some(add_project),
                projects_turn,
                window,
                cx,
            ));
            let mut section_rows: Vec<AnyElement> = Vec::new();
            {
                let list = &mut section_rows;
                if store.projects.is_empty() {
                    list.push(
                        div()
                            .px(px(space::X2_5))
                            .py(px(space::X1_5))
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("nav.emptyProjects").into_owned())
                            .into_any_element(),
                    );
                }
                let project_order = self.project_reorder(store.projects.iter().map(|p| p.id.clone()).collect());
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
                        (_, r) if r > 0 => WorkingRing::new(SharedString::from(format!("project-ring-{}", project.id)))
                            .size(icon::XS)
                            .into_any_element(),
                        _ => div()
                            .text_xs()
                            .text_color(p.text_dim)
                            .child(chats.len().to_string())
                            .into_any_element(),
                    };
                    let (toggle, new_in) = (project.id.clone(), project.id.clone());
                    let menu = Self::project_menu(&cx.entity(), project.id.clone(), project.name.clone());
                    let drag = DragRow {
                        group: "projects".into(),
                        id: project.id.clone().into(),
                        label: project.name.clone().into(),
                    };
                    let more = more_button(
                        format!("project-more-{}", project.id),
                        project.name.clone(),
                        menu.clone(),
                    );
                    let turn = project_turns.get(&project.id).copied().unwrap_or(px(0.));
                    list.push(
                        NavRow::new(
                            SharedString::from(format!("project-{}", project.id)),
                            project.name.clone(),
                        )
                        .leading(
                            icon(IconName::ChevronDown, icon::MD)
                                .text_color(p.text_muted)
                                .rotate(radians(f32::from(turn).to_radians())),
                        )
                        .expanded(expanded)
                        .active(
                            self.route
                                == (Route::Home {
                                    project_id: Some(project.id.clone()),
                                }),
                        )
                        .trailing(trailing)
                        .menu(menu)
                        .reorder(drag, project_order.clone())
                        .on_hover_trailing(
                            div()
                                .flex()
                                .items_center()
                                .child(
                                    Button::icon_only(
                                        SharedString::from(format!("new-in-{}", project.id)),
                                        IconName::Plus,
                                        t!("nav.newChatIn", name = project.name).into_owned(),
                                    )
                                    .size(Size::Xs)
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| {
                                            this.go(
                                                Route::Home {
                                                    project_id: Some(new_in.clone()),
                                                },
                                                cx,
                                            )
                                        },
                                    )),
                                )
                                .child(more),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| this.toggle_project(&toggle, cx)))
                        .into_any_element(),
                    );
                    {
                        // An empty project shows nothing under it (its + starts a chat).
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
                        let key = format!("project:{}", project.id);
                        let view = cx.entity().downgrade();
                        let height = heights.get(&key).copied().flatten();
                        list.push(self.collapse.wrap(&key, height, rows, move |cx| {
                            let _ = view.update(cx, |_, cx| cx.notify());
                        }));
                    }
                }
            }
            {
                let view = cx.entity().downgrade();
                let height = heights.get("projects").copied().flatten();
                list.push(self.collapse.wrap("projects", height, section_rows, move |cx| {
                    let _ = view.update(cx, |_, cx| cx.notify());
                }));
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
            let add = Button::icon_only("new-chat", IconName::Plus, t!("nav.newChat").into_owned())
                .size(Size::Xs)
                .on_click(cx.listener(|this, _, _, cx| this.go(Route::Home { project_id: None }, cx)))
                .into_any_element();
            list.push(self.section(
                LOOSE,
                (t!("nav.chats").into_owned(), loose_waiting),
                Some(add),
                loose_turn,
                window,
                cx,
            ));
            let mut loose_rows: Vec<AnyElement> = Vec::new();
            {
                let list = &mut loose_rows;
                if loose.is_empty() {
                    list.push(
                        div()
                            .px(px(space::X2_5))
                            .py(px(space::X1_5))
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
            let view = cx.entity().downgrade();
            let height = heights.get(LOOSE).copied().flatten();
            list.push(self.collapse.wrap(LOOSE, height, loose_rows, move |cx| {
                let _ = view.update(cx, |_, cx| cx.notify());
            }));
        }

        let fold = Button::icon_only(
            "fold",
            if folded {
                IconName::PanelLeftOpen
            } else {
                IconName::PanelLeftClose
            },
            if folded {
                t!("nav.showSidebar").into_owned()
            } else {
                t!("nav.hideSidebar").into_owned()
            },
        )
        .size(if folded { Size::Lg } else { Size::Sm })
        .on_click(cx.listener(|this, _, _, cx| this.toggle_folded(cx)));
        // Folded, the search is one more rail square (same shape, wash and hover as the places).
        let rail_search = NavRow::new("search-rail", t!("nav.searchOrGo").into_owned())
            .icon(IconName::Search)
            .rail(true)
            .on_click(cx.listener(|_, _, _, cx| cx.emit(SidebarEvent::Palette)));
        let search = div()
            .id("search")
            .cursor_pointer()
            .on_click(cx.listener(|_, _, _, cx| cx.emit(SidebarEvent::Palette)))
            .flex()
            .items_center()
            .gap(px(space::X2))
            .h(px(tokens::CONTROL_H))
            // Folded, the search is a square on the rail's column, its glass centred like the places' marks.
            .px(px(space::X2_5))
            .rounded(px(tokens::RADIUS_CONTROL))
            .bg(p.bg_control)
            .text_color(p.text_muted)
            .child(icon(IconName::Search, icon::MD))
            .when(!folded, |s| {
                s.child(div().flex_1().truncate().child(t!("nav.searchOrGo").into_owned()))
                    .child(
                        div()
                            .px(px(space::X1))
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
            .gap(px(if folded { space::X2 } else { space::X4 }))
            .py(px(space::X2))
            .px(px(if folded {
                (RAIL_WIDTH - RAIL_ITEM) / 2.
            } else {
                space::X3
            }))
            .pt(px(crate::ui::header::TOP)) // clears the traffic lights; the title strip shares it
            .bg(p.bg_sidebar)
            .text_color(p.text_secondary)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2_5))
                    .h(px(crate::ui::header::ROW)) // the head row, level with the screen's title
                    .when(folded, |h| h.justify_center())
                    .when(!folded, |h| h.pl(px(space::X2_5))) // the logo on the icons' column (row padding)
                    .when(!folded, |h| {
                        h.child(
                            svg()
                                .path(crate::assets::LOGO)
                                .size(px(crate::ui::header::LOGO))
                                .text_color(p.text),
                        )
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
            .map(|c| if folded { c.child(rail_search) } else { c.child(search) })
            .child(div().flex().flex_col().gap(px(space::X0_5)).children(places))
            .when(!folded, |c| {
                c.child(
                    div()
                        .id("sidebar-list")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .gap(px(space::X0_5))
                        .children(list),
                )
            })
            .when(folded, |c| c.items_center().child(div().flex_1())) // folded: one centred column, the foot at the bottom
            .child(self.foot(folded, window, cx))
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

/// The ⋯ button that opens a row's menu (same items as its right-click).
fn more_button(id: String, name: String, menu: crate::ui::nav::MenuBuilder) -> impl IntoElement {
    let trigger = Button::icon_only(
        SharedString::from(format!("{id}-trigger")),
        IconName::Ellipsis,
        t!("nav.moreFor", name = name).into_owned(),
    )
    .size(Size::Xs);
    crate::ui::menu::dropdown(SharedString::from(id), trigger, menu)
}
