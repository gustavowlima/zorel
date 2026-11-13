// A select (apps/web/src/ui/select.tsx, ghost variant): the trigger is a 26px control-radius button that shows the
// choice (its mark and name) and a chevron that turns while open; the list floats on `layout::float` (card radius,
// inset 6) with 32px rows at the row radius, concentric with it, the chosen one checked. Hover eases in (ui/motion).
// The kit's Popover places it, animates it in and closes it on Escape or a click outside.
// Past SEARCH_AT options a search field sits on top of the list (focused on open) and filters it by name.
use std::{f32::consts::PI, rc::Rc};

use gpui_kit::{
    assets::IconName,
    component::{
        Selectable,
        input::{Input, InputState},
        popover::Popover,
    },
    prelude::FluentBuilder,
    *,
};

use crate::ui::icon::{self, icon};
use crate::ui::space;
use crate::{
    theme::{self, tokens},
    ui::{face::AgentFace, layout, motion},
};

/// What an option shows before its name.
#[derive(Clone, PartialEq)]
pub enum Mark {
    None,
    Face(usize),
    Icon(IconName),
}

#[derive(Clone, PartialEq)]
pub struct SelectOption {
    pub id: String,
    pub label: SharedString,
    pub mark: Mark,
}

/// More options than this and the list gets a search field (the web's SEARCH_AT).
const SEARCH_AT: usize = 8;

/// The options whose name holds what is typed (ignoring case); all of them with nothing typed.
pub fn matching<'a>(options: &'a [SelectOption], query: &str) -> Vec<&'a SelectOption> {
    let q = query.trim().to_lowercase();
    options
        .iter()
        .filter(|o| q.is_empty() || o.label.to_lowercase().contains(&q))
        .collect()
}

pub type OnPick = Rc<dyn Fn(&str, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct Select {
    id: ElementId,
    /// What screen readers call it ("Project").
    name: SharedString,
    options: Vec<SelectOption>,
    selected: String,
    /// Shown before the choice in the trigger (the project's folder).
    prefix: Option<IconName>,
    /// The search field's placeholder (only past SEARCH_AT options).
    search: Option<SharedString>,
    on_pick: OnPick,
    /// A form's field (the text fields' wash, hairline and height, the row's width), not a quiet toolbar choice.
    filled: bool,
}

impl Select {
    pub fn filled(mut self) -> Self {
        self.filled = true;
        self
    }

    pub fn new(
        id: impl Into<ElementId>,
        name: impl Into<SharedString>,
        options: Vec<SelectOption>,
        selected: impl Into<String>,
        on_pick: OnPick,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            options,
            selected: selected.into(),
            prefix: None,
            search: None,
            on_pick,
            filled: false,
        }
    }

    pub fn prefix(mut self, icon: IconName) -> Self {
        self.prefix = Some(icon);
        self
    }

    pub fn search(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.search = Some(placeholder.into());
        self
    }
}

impl RenderOnce for Select {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let chosen = self.options.iter().find(|o| o.id == self.selected).cloned();
        let trigger = Trigger {
            id: SharedString::from(format!("{}-trigger", self.id)).into(),
            name: self.name.clone(),
            prefix: self.prefix,
            chosen,
            open: false,
            filled: self.filled,
        };
        let filled = self.filled;
        let (options, selected, on_pick, key) = (self.options, self.selected, self.on_pick, self.id.to_string());
        let enter_key = SharedString::from(format!("{key}-enter"));
        let search_key = SharedString::from(format!("{key}-search"));
        let placeholder = self.search.unwrap_or_else(|| self.name.clone());
        Popover::new(self.id)
            .when(filled, |p| p.w_full())
            .anchor(Anchor::TopLeft)
            .offset(px(6.))
            .appearance(false)
            .trigger(trigger)
            .content(move |_, window, cx| {
                let popover = cx.entity();
                // A fresh, focused field each time the list opens (the state lives while the list is shown).
                let query = (options.len() > SEARCH_AT).then(|| {
                    let placeholder = placeholder.clone();
                    window.use_keyed_state(search_key.clone(), cx, move |window, cx| {
                        let state = InputState::new(window, cx).placeholder(placeholder);
                        state.focus_handle(cx).focus(window, cx);
                        state
                    })
                });
                let typed = query
                    .as_ref()
                    .map(|q| q.read(cx).value().to_string())
                    .unwrap_or_default();
                let shown = matching(&options, &typed);
                let p = theme::palette(window);
                let list = layout::panel("options", p)
                    .min_w(px(if query.is_some() { 256. } else { 160. }))
                    .max_w(px(280.))
                    .max_h(px(320.))
                    .flex()
                    .flex_col()
                    .overflow_y_scroll()
                    .role(Role::ListBox)
                    .when_some(query, |l, q| {
                        l.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(space::X2))
                                .h(px(tokens::CONTROL_H_SM))
                                .px(px(space::X2_5))
                                .mb(px(space::X1))
                                .rounded(px(tokens::RADIUS_CONTROL_SM))
                                .bg(p.bg_field)
                                .text_sm()
                                .child(icon(IconName::Search, icon::SM).text_color(p.text_muted))
                                .child(div().flex_1().child(Input::new(&q).appearance(false))),
                        )
                    })
                    .children(shown.into_iter().map(|o| {
                        let on_pick = on_pick.clone();
                        let popover = popover.clone();
                        let id = o.id.clone();
                        option_row(&key, o, o.id == selected, window, cx).on_click(move |_, window, cx| {
                            on_pick(&id, window, cx);
                            popover.update(cx, |s, cx| s.dismiss(window, cx));
                        })
                    }));
                motion::enter(list, enter_key.clone(), motion::MENU_IN_MS, -4.)
            })
    }
}

/// The ghost trigger: mark, name, chevron; the control wash while hovered or open.
#[derive(IntoElement)]
struct Trigger {
    id: ElementId,
    name: SharedString,
    prefix: Option<IconName>,
    chosen: Option<SelectOption>,
    open: bool,
    filled: bool,
}

impl Selectable for Trigger {
    fn selected(mut self, selected: bool) -> Self {
        self.open = selected;
        self
    }

    fn is_selected(&self) -> bool {
        self.open
    }
}

impl RenderOnce for Trigger {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let pointer = motion::pointer(&self.id, window, cx);
        let lit = pointer.read(cx).hovered || self.open;
        let rest = if self.filled {
            p.bg_field
        } else {
            Rgba {
                a: 0.,
                ..p.bg_control_hover
            }
        };
        let bg = motion::color(
            &self.id,
            "bg",
            if lit && !self.filled { p.bg_control_hover } else { rest },
            window,
            cx,
        );
        let filled = self.filled;
        let fg = motion::color(&self.id, "fg", if lit { p.text } else { p.text_secondary }, window, cx);
        let label = self.chosen.as_ref().map(|c| c.label.clone()).unwrap_or_default();
        let row = div()
            .id(self.id.clone())
            .role(Role::ComboBox)
            .aria_label(self.name)
            .aria_expanded(self.open)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X1_5))
            .px(px(space::X2_5))
            .rounded(px(tokens::RADIUS_CONTROL))
            .bg(bg)
            .map(|r| {
                if filled {
                    r.w_full().h(px(tokens::CONTROL_H)).border_1().border_color(if lit {
                        p.text_dim
                    } else {
                        p.border_strong
                    })
                } else {
                    r.h(px(tokens::CONTROL_H_SM)).max_w(px(256.))
                }
            })
            .text_sm()
            .text_color(fg)
            .when_some(self.prefix, |r, icon_name| r.child(icon(icon_name, icon::MD)))
            .when_some(self.chosen.as_ref().map(|c| c.mark.clone()), |r, m| {
                r.children(mark(&format!("{}-mark", self.id), &m))
            })
            .child(div().min_w_0().truncate().when(filled, |d| d.flex_1()).child(label))
            .child(
                icon(IconName::ChevronDown, icon::XS)
                    .text_color(Rgba { a: 0.7, ..fg.into() })
                    .rotate(radians(if self.open { PI } else { 0. })),
            );
        motion::track(row, &pointer)
    }
}

fn option_row(key: &str, o: &SelectOption, selected: bool, window: &mut Window, cx: &mut App) -> Stateful<Div> {
    let p = theme::palette(window);
    let id = ElementId::from(format!("{key}-option-{}", o.id));
    let pointer = motion::pointer(&id, window, cx);
    let hovered = pointer.read(cx).hovered;
    let bg = motion::color(
        &id,
        "bg",
        if hovered {
            p.bg_control
        } else {
            motion::fade(p.bg_control, 0.)
        },
        window,
        cx,
    );
    let fg = if hovered || selected { p.text } else { p.text_secondary };
    let row = div()
        .id(id.clone())
        .role(Role::ListBoxOption)
        .aria_selected(selected)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(space::X2))
        .h(px(tokens::CONTROL_H)) // a comfortable row: the sidebar's height
        .px(px(space::X2_5))
        .rounded(px(tokens::RADIUS_ROW))
        .bg(bg)
        .text_color(fg)
        .children(mark(&format!("{id}-mark"), &o.mark))
        .child(div().flex_1().min_w_0().truncate().child(o.label.clone()))
        .when(selected, |r| {
            r.child(icon(IconName::Check, icon::MD).text_color(p.accent_text))
        });
    motion::track(row, &pointer)
}

fn mark(key: &str, mark: &Mark) -> Option<AnyElement> {
    match mark {
        Mark::None => None,
        Mark::Face(tone) => Some(
            AgentFace::new(SharedString::from(key.to_string()), *tone)
                .size(16.)
                .into_any_element(),
        ),
        Mark::Icon(name) => Some(icon(*name, icon::MD).into_any_element()),
    }
}

#[cfg(test)]
mod tests {
    use super::{Mark, SelectOption, matching};

    #[test]
    fn the_search_keeps_the_options_whose_name_holds_what_is_typed() {
        let options: Vec<SelectOption> = ["Atlas", "Zorel web", "Notes"]
            .iter()
            .map(|n| SelectOption {
                id: n.to_lowercase(),
                label: (*n).into(),
                mark: Mark::None,
            })
            .collect();
        let names = |q: &str| {
            matching(&options, q)
                .iter()
                .map(|o| o.label.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(names("  "), ["Atlas", "Zorel web", "Notes"]);
        assert_eq!(names("WEB"), ["Zorel web"]);
        assert!(names("xyz").is_empty());
    }
}
