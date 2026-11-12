// The palette (⌘K / Ctrl K, the sidebar's search; apps/web/src/features/palette.tsx and ui/command.tsx): the places
// and quick actions always, and the chats and projects whose names hold what is typed. Arrows move, Enter opens,
// Escape or a click outside closes; the pointer selects what it rests on. A 576px float (card radius) 12% from the
// top: a 48px search row over the list (inset 6), group titles in small muted text, rows at the row radius with the
// selection washed in the accent.
// ponytail: searching inside messages ("In messages") needs /api/search results in the list; it comes with the
// chat screen's search. Agents join when their screen exists.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::{
        WindowExt as _,
        input::{Input, InputEvent, InputState},
    },
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    format,
    labels::chat_title,
    route::Route,
    state::store::Store,
    theme::{self, tokens},
    ui::{
        icon::{self, icon},
        layout, space,
    },
};

/// What a palette row does.
#[derive(Clone)]
pub enum Target {
    Go(Route),
    ToggleSidebar,
}

pub type OnPick = Rc<dyn Fn(Target, &mut Window, &mut App) + 'static>;

#[derive(Clone)]
struct Entry {
    label: String,
    hint: Option<String>,
    icon: IconName,
    target: Target,
}

/// Opens the palette over the window.
pub fn open(store: &Entity<Store>, on_pick: OnPick, window: &mut Window, cx: &mut App) {
    let palette = cx.new(|cx| Palette::new(store.clone(), on_pick, window, cx));
    let top = window.viewport_size().height * 0.12;
    window.open_dialog(cx, move |dialog, window, _| {
        layout::float(
            dialog.close_button(false).w(px(576.)).margin_top(top),
            theme::palette(window),
        )
        .p_0()
        .child(palette.clone())
    });
}

struct Palette {
    store: Entity<Store>,
    query: Entity<InputState>,
    selected: usize,
    scroll: ScrollHandle,
    on_pick: OnPick,
    _subscription: Subscription,
}

impl Palette {
    fn new(store: Entity<Store>, on_pick: OnPick, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let query = cx.new(|cx| InputState::new(window, cx).placeholder(t!("palette.placeholder").into_owned()));
        query.update(cx, |q, cx| q.focus(window, cx));
        let subscription = cx.subscribe_in(&query, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::Change => {
                this.selected = 0;
                cx.notify();
            }
            InputEvent::PressEnter { .. } => this.confirm(window, cx),
            _ => {}
        });
        Self {
            store,
            query,
            selected: 0,
            scroll: ScrollHandle::new(),
            on_pick,
            _subscription: subscription,
        }
    }

    /// The groups to show for what is typed: chats and projects only once something is typed (as the web).
    fn groups(&self, cx: &App) -> Vec<(String, Vec<Entry>)> {
        let q = self.query.read(cx).value().trim().to_lowercase();
        let has = |text: &str| q.is_empty() || text.to_lowercase().contains(&q);
        let store = self.store.read(cx);
        let now = format::now_ms();
        let chats: Vec<Entry> = if q.is_empty() {
            Vec::new()
        } else {
            store
                .chats
                .chats
                .iter()
                .filter(|c| c.parent_id.is_none() && has(&chat_title(c)))
                .take(8)
                .map(|c| Entry {
                    label: chat_title(c),
                    hint: Some(format::age(c.last_at.unwrap_or(c.created_at), now, format::lang())),
                    icon: IconName::MessageCircle,
                    target: Target::Go(Route::Chat { id: c.id.clone() }),
                })
                .collect()
        };
        let projects: Vec<Entry> = if q.is_empty() {
            Vec::new()
        } else {
            store
                .projects
                .iter()
                .filter(|p| has(&p.name))
                .take(5)
                .map(|p| Entry {
                    label: p.name.clone(),
                    hint: None,
                    icon: IconName::Folder,
                    target: Target::Go(Route::Home {
                        project_id: Some(p.id.clone()),
                    }),
                })
                .collect()
        };
        let place = |key: &str, icon: IconName, target: Target| Entry {
            label: t!(key).into_owned(),
            hint: None,
            icon,
            target,
        };
        let places: Vec<Entry> = [
            place(
                "nav.homeScreen",
                IconName::House,
                Target::Go(Route::Home { project_id: None }),
            ),
            place("nav.needsYou", IconName::Inbox, Target::Go(Route::Inbox)),
            place(
                "nav.newChat",
                IconName::Plus,
                Target::Go(Route::Home { project_id: None }),
            ),
            place("palette.toggleSidebar", IconName::PanelLeftClose, Target::ToggleSidebar),
        ]
        .into_iter()
        .filter(|e| has(&e.label))
        .collect();
        [
            (t!("nav.chats").into_owned(), chats),
            (t!("nav.projects").into_owned(), projects),
            (t!("palette.go").into_owned(), places),
        ]
        .into_iter()
        .filter(|(_, items)| !items.is_empty())
        .collect()
    }

    fn confirm(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let entries: Vec<Entry> = self.groups(cx).into_iter().flat_map(|(_, e)| e).collect();
        if let Some(entry) = entries.get(self.selected) {
            window.close_dialog(cx);
            (self.on_pick)(entry.target.clone(), window, cx);
        }
    }

    fn step(&mut self, by: isize, cx: &mut Context<Self>) {
        let count = self.groups(cx).iter().map(|(_, e)| e.len()).sum::<usize>();
        if count == 0 {
            return;
        }
        self.selected = (self.selected as isize + by).rem_euclid(count as isize) as usize;
        cx.notify();
    }
}

impl Render for Palette {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Palette {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let groups = self.groups(cx);
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut ix = 0;
        let mut selected_child = 0;
        for (title, entries) in groups {
            rows.push(
                div()
                    .px(px(space::X2_5))
                    .pt(px(space::X2))
                    .pb(px(space::X1))
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(p.text_muted)
                    .child(title)
                    .into_any_element(),
            );
            for entry in entries {
                let on = ix == self.selected;
                if on {
                    selected_child = rows.len();
                }
                let here = ix;
                rows.push(
                    div()
                        .id(("palette-row", ix))
                        .role(Role::ListBoxOption)
                        .aria_selected(on)
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(space::X2_5))
                        .min_h(px(tokens::CONTROL_H))
                        .px(px(space::X2_5))
                        .py(px(space::X1_5))
                        .rounded(px(tokens::RADIUS_ROW))
                        .when(on, |r| r.bg(p.accent_soft))
                        .text_color(if on { p.text } else { p.text_secondary })
                        .child(icon(entry.icon, icon::MD).text_color(if on { p.accent_text } else { p.text_muted }))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .child(div().truncate().child(entry.label))
                                .when_some(entry.hint, |c, h| {
                                    c.child(div().truncate().text_sm().text_color(p.text_muted).child(h))
                                }),
                        )
                        .on_mouse_move(cx.listener(move |this, _, _, cx| {
                            if this.selected != here {
                                this.selected = here;
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.selected = here;
                            this.confirm(window, cx);
                        }))
                        .into_any_element(),
                );
                ix += 1;
            }
        }
        if ix > 0 {
            self.scroll.scroll_to_item(selected_child);
        }
        div()
            .flex()
            .flex_col()
            .max_h(window.viewport_size().height * 0.6)
            // Arrows move the selection before the field sees them.
            .capture_key_down(
                cx.listener(|this, event: &KeyDownEvent, _, cx| match event.keystroke.key.as_str() {
                    "down" => {
                        this.step(1, cx);
                        cx.stop_propagation();
                    }
                    "up" => {
                        this.step(-1, cx);
                        cx.stop_propagation();
                    }
                    _ => {}
                }),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(space::X2_5))
                    .h(px(space::X12))
                    .px(px(space::X4))
                    .border_b_1()
                    .border_color(p.border)
                    .child(icon(IconName::Search, icon::MD).text_color(p.text_muted))
                    .child(div().flex_1().child(Input::new(&self.query).appearance(false))),
            )
            .child(
                div()
                    .id("palette-list")
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .flex_1()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .p(px(tokens::INSET_CARD))
                    .when(ix == 0, |l| {
                        l.child(
                            div()
                                .px(px(space::X4))
                                .py(px(space::X6))
                                .text_center()
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(t!("palette.empty").into_owned()),
                        )
                    })
                    .children(rows),
            )
    }
}
