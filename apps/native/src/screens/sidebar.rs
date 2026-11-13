// The sidebar (spec 019, parity/sidebar.md, prototype parity/prototype/Sidebar.dc.html): the mark and the fold button,
// search, the places, then Projects (each with its chats) and loose Chats, in the web's order: whose turn it is first
// (waiting for you, then working), then chats never placed by hand by latest activity, then the placed ones. Five chats
// per group until "Show more"; the open chat always shows. Folded (⌘B) it is a 56px rail of the places. Its folded
// state, open projects and closed sections are remembered (state/prefs.rs).
// Row menus and new project: sidebar_actions.rs; the foot (usage, pause, settings): sidebar_foot.rs.
// ponytail: Routines and Memory stay disabled until their screens exist.
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

use gpui_kit::{assets::IconName, base::spring, prelude::FluentBuilder, *};
use rust_i18n::t;

mod order;
mod reorder;
mod rows;

use order::*;
pub use order::{face_state, lifted, ordered};
use rows::*;

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
        nav::{DragRow, NavRow, Reorder},
        reorder::{DragMark, Flip, OnDrop, OnOver, Preview},
    },
};

const OPEN_WIDTH: f32 = 268.;
/// The sidebar's places, in their default order.
const PLACES: [&str; 5] = ["nav-home", "nav-inbox", "nav-agents", "nav-routines", "nav-memory"];
const RAIL_WIDTH: f32 = 56.; // RAIL_ITEM + 2 × space::X3
/// Below this window width the sidebar stays folded.
const NARROW: f32 = 900.;

/// Every item on the folded rail is this square (fold, search, places, foot), centred: 12px each side.
const RAIL_ITEM: f32 = tokens::CONTROL_H;
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
    /// Heights of what opens and closes (sections, projects), for their animation.
    collapse: crate::ui::collapse::Measured,
    /// The order a drag shows right now.
    preview: Option<Preview>,
    /// An order just dropped, shown until the engine's lists catch up (a few seconds at most).
    held: HashMap<String, (Vec<String>, std::time::Instant)>,
    /// Where each row was laid out, so reordered rows slide.
    flip: Flip,
    /// Each group's order as last drawn (where a dragged row is now, for the direction of travel).
    shown: std::cell::RefCell<HashMap<String, Vec<String>>>,
    /// Groups showing every chat ("chats" or a project id); in memory only, as the web.
    show_all: HashSet<String>,
    pub route: Route,
    /// Needs you: open approvals and proposed memories (from Root).
    pub pending: usize,
    /// The chats and projects list: whether more lies past its top or bottom edge (its fades).
    list_scroll: ScrollHandle,
}

impl Sidebar {
    pub fn new(store: Entity<Store>, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        Self {
            store,
            collapse: Default::default(),
            preview: None,
            held: HashMap::new(),
            flip: Flip::default(),
            shown: Default::default(),
            show_all: HashSet::new(),
            route: Route::default(),
            pending: 0,
            list_scroll: ScrollHandle::new(),
        }
    }

    /// Whether it is the narrow rail (the window's title strip then clears the traffic lights itself).
    pub fn folded(&self, cx: &App) -> bool {
        Prefs::get(cx).sidebar_folded
    }

    pub fn toggle_folded(&mut self, cx: &mut Context<Self>) {
        Prefs::update(cx, |p| p.sidebar_folded = !p.sidebar_folded);
        cx.notify();
    }

    fn toggle_section(&mut self, section: &str, cx: &mut Context<Self>) {
        Prefs::update(cx, |p| flip(&mut p.collapsed_sections, section));
        cx.notify();
    }

    fn toggle_project(&mut self, id: &str, cx: &mut Context<Self>) {
        Prefs::update(cx, |p| flip(&mut p.expanded_projects, id));
        cx.notify();
    }

    fn go(&mut self, route: Route, cx: &mut Context<Self>) {
        cx.emit(SidebarEvent::Navigate(route));
    }
}

/// The same ids, in any order (a held order still fits the list).
/// A place's name and icon (its ghost while dragged).
fn place_look(id: &str) -> (String, IconName) {
    const LOOK: [(&str, &str, IconName); 5] = [
        ("nav-home", "nav.homeScreen", IconName::House),
        ("nav-inbox", "nav.needsYou", IconName::Inbox),
        ("nav-agents", "nav.agents", IconName::Bot),
        ("nav-routines", "nav.routines", IconName::AlarmClock),
        ("nav-memory", "nav.memory", IconName::Brain),
    ];
    LOOK.iter()
        .find(|(i, _, _)| *i == id)
        .map_or((id.to_string(), IconName::House), |(_, key, icon)| {
            (t!(*key).into_owned(), *icon)
        })
}

impl Sidebar {}

/// What every row reads: the store and each chat's (lifted) status.
struct Lists<'a> {
    store: &'a Store,
    statuses: &'a HashMap<String, ChatStatus>,
}

impl Sidebar {}

impl Render for Sidebar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Sidebar {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        // A narrow window keeps the rail (the web folds below 900px), whatever was chosen.
        let folded = Prefs::get(cx).sidebar_folded || window.viewport_size().width < px(NARROW);
        let width = spring(
            "sidebar-width",
            px(if folded { RAIL_WIDTH } else { OPEN_WIDTH }),
            motion::settle(motion::SETTLE_MS),
            window,
            cx,
        );
        // Each section's chevron turns on a spring (down = open).
        let mut turn = |key: &'static str| {
            let closed = Prefs::get(cx).collapsed_sections.contains(key);
            spring(
                SharedString::from(format!("section-turn-{key}")),
                px(if closed { -90. } else { 0. }),
                motion::settle(motion::SETTLE_MS),
                window,
                cx,
            )
        };
        let (projects_turn, loose_turn) = (turn("projects"), turn(LOOSE));
        // A drag let go outside any row: everything goes back.
        if self.preview.is_some() && !cx.has_active_drag() {
            self.preview = None;
        }
        // What opens and closes springs its height; a project's chevron turns.
        let mut heights: HashMap<String, Option<(Pixels, f32)>> = HashMap::new();
        let mut project_turns: HashMap<String, Pixels> = HashMap::new();
        for key in ["projects", LOOSE] {
            let open = !Prefs::get(cx).collapsed_sections.contains(key);
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
                    (pr.id.clone(), here || Prefs::get(cx).expanded_projects.contains(&pr.id))
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
        // Rows slide only while reordering: a drag on, or an order just dropped.
        let reordering = self.preview.is_some()
            || self
                .held
                .values()
                .any(|(_, at)| at.elapsed() < std::time::Duration::from_millis(motion::REORDER_MS + 200));
        let cx: &Context<Self> = cx; // from here on only listeners and reads
        let store_entity = self.store.clone();
        let store = store_entity.read(cx);
        let statuses = lifted(&store.chats.chats, &store.chats.statuses);
        let place =
            |this: &Self, id: &'static str, icon: IconName, label: String, route: Option<Route>, cx: &Context<Self>| {
                // Agents stays current while building one (the web's agents/agent/new-agent/builder).
                let active = route.as_ref().is_some_and(|r| {
                    *r == this.route
                        || (*r == Route::Agents && matches!(this.route, Route::Builder { .. } | Route::Agent { .. }))
                });
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
        // The web's Count: an accent pill with the number (the folded rail puts it on the item's corner).
        .when(pending > 0, |r| {
            r.trailing(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .h(px(18.))
                    .min_w(px(18.))
                    .px(px(space::X1_5))
                    .rounded_full()
                    .bg(p.accent)
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(p.on_accent)
                    .child(pending.to_string()),
            )
        });
        let mut by_id: HashMap<&'static str, NavRow> = HashMap::new();
        by_id.insert(
            "nav-home",
            place(
                self,
                "nav-home",
                IconName::House,
                t!("nav.homeScreen").into_owned(),
                Some(Route::Home { project_id: None }),
                cx,
            ),
        );
        by_id.insert("nav-inbox", inbox);
        by_id.insert(
            "nav-agents",
            place(
                self,
                "nav-agents",
                IconName::Bot,
                t!("nav.agents").into_owned(),
                Some(Route::Agents),
                cx,
            ),
        );
        by_id.insert(
            "nav-routines",
            place(
                self,
                "nav-routines",
                IconName::AlarmClock,
                t!("nav.routines").into_owned(),
                None,
                cx,
            ),
        );
        by_id.insert(
            "nav-memory",
            place(
                self,
                "nav-memory",
                IconName::Brain,
                t!("nav.memory").into_owned(),
                None,
                cx,
            ),
        );
        // In the person's order, each draggable (live), sliding when the order changes.
        let dragging = self.preview.as_ref().map(|p| p.dragged.clone());
        let places: Vec<(String, AnyElement)> = self
            .display("places", self.place_order(cx))
            .into_iter()
            .filter_map(|id| {
                let row = by_id.remove(id.as_str())?;
                let (label, mark) = place_look(&id);
                let row = row
                    .reorder(self.reorder_of("places", &id, label, DragMark::Icon(mark), cx))
                    .lifted(dragging.as_deref() == Some(id.as_str()))
                    .into_any_element();
                Some((id, row))
            })
            .collect();

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
                // Projects in the order shown (dropped or being dragged first); each block (its row and its chats)
                // slides when the order changes.
                let shown = self.display("projects", store.projects.iter().map(|p| p.id.clone()).collect());
                let mut projects: Vec<_> = store.projects.iter().collect();
                projects.sort_by_key(|pr| shown.iter().position(|id| *id == pr.id).unwrap_or(usize::MAX));
                let dragging = self.preview.as_ref().map(|p| p.dragged.clone());
                let mut blocks: Vec<(String, AnyElement)> = Vec::new();
                for project in projects {
                    let mut block: Vec<AnyElement> = Vec::new();
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
                    let expanded = open_here || Prefs::get(cx).expanded_projects.contains(&project.id);
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
                    let more = more_button(
                        format!("project-more-{}", project.id),
                        project.name.clone(),
                        menu.clone(),
                    );
                    let turn = project_turns.get(&project.id).copied().unwrap_or(px(0.));
                    block.push(
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
                        .reorder(self.reorder_of(
                            "projects",
                            &project.id,
                            project.name.clone(),
                            DragMark::Icon(IconName::Folder),
                            cx,
                        ))
                        .lifted(dragging.as_deref() == Some(project.id.as_str()))
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
                            window,
                            cx,
                        );
                        let key = format!("project:{}", project.id);
                        let view = cx.entity().downgrade();
                        let height = heights.get(&key).copied().flatten();
                        let chats_list = self.flip.list(&project.id, rows, space::X0_5, reordering, {
                            let view = view.clone();
                            move |cx| {
                                let _ = view.update(cx, |_, cx| cx.notify());
                            }
                        });
                        block.push(
                            self.collapse
                                .wrap(&key, height, vec![chats_list.into_any_element()], move |cx| {
                                    let _ = view.update(cx, |_, cx| cx.notify());
                                }),
                        );
                    }
                    blocks.push((
                        project.id.clone(),
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X0_5))
                            .children(block)
                            .into_any_element(),
                    ));
                }
                let view = cx.entity().downgrade();
                list.push(
                    self.flip
                        .list("projects", blocks, space::X0_5, reordering, move |cx| {
                            let _ = view.update(cx, |_, cx| cx.notify());
                        })
                        .into_any_element(),
                );
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
                    window,
                    cx,
                );
                let view = cx.entity().downgrade();
                list.push(
                    self.flip
                        .list(LOOSE, rows, space::X0_5, reordering, move |cx| {
                            let _ = view.update(cx, |_, cx| cx.notify());
                        })
                        .into_any_element(),
                );
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
        .size(if folded { Size::Md } else { Size::Sm })
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
            .child({
                let view = cx.entity().downgrade();
                self.flip.list("places", places, space::X0_5, reordering, move |cx| {
                    let _ = view.update(cx, |_, cx| cx.notify());
                })
            })
            .when(!folded, |c| {
                // More of the list past an edge fades out over that edge (24px), as the web's fade-top/bottom.
                let (offset, max) = (self.list_scroll.offset().y, self.list_scroll.max_offset().y);
                let (above, below) = (offset < px(-0.5), max + offset > px(0.5));
                let fade = |top: bool| {
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .h(px(space::X6))
                        .map(|d| if top { d.top_0() } else { d.bottom_0() })
                        .bg(linear_gradient(
                            if top { 180. } else { 0. },
                            linear_color_stop(p.bg_sidebar, 0.),
                            linear_color_stop(motion::fade(p.bg_sidebar, 0.), 1.),
                        ))
                };
                c.child(
                    div()
                        .relative()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .id("sidebar-list")
                                // The same side room as ui/collapse, so the rows' drag grips aren't clipped by the scroll.
                                .mx(px(-crate::ui::collapse::GUTTER))
                                .px(px(crate::ui::collapse::GUTTER))
                                .flex_1()
                                .min_h_0()
                                .overflow_y_scroll()
                                .track_scroll(&self.list_scroll)
                                .flex()
                                .flex_col()
                                .gap(px(space::X0_5))
                                .children(list),
                        )
                        .when(above, |c| c.child(fade(true)))
                        .when(below, |c| c.child(fade(false))),
                )
            })
            .when(folded, |c| c.items_center().child(div().flex_1())) // folded: one centred column, the foot at the bottom
            .child(self.foot(folded, window, cx))
    }
}
