// A select (apps/web/src/ui/select.tsx, ghost variant): the trigger is a 26px control-radius button that shows the
// choice (its mark and name) and a chevron that turns while open; the list floats on `layout::float` (card radius,
// inset 6) with 32px rows at the row radius, concentric with it, the chosen one checked. Hover eases in (ui/motion).
// The kit's Popover places it, animates it in and closes it on Escape or a click outside.
// ponytail: no search field yet (the web adds one past 8 options); ⌘K finds projects and agents meanwhile.
use std::{f32::consts::PI, rc::Rc};

use gpui_kit::{
    assets::IconName,
    component::{Selectable, popover::Popover},
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
    on_pick: OnPick,
}

impl Select {
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
            on_pick,
        }
    }

    pub fn prefix(mut self, icon: IconName) -> Self {
        self.prefix = Some(icon);
        self
    }
}

impl RenderOnce for Select {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let chosen = self.options.iter().find(|o| o.id == self.selected).cloned();
        let trigger = Trigger {
            id: SharedString::from(format!("{}-trigger", self.id)).into(),
            name: self.name.clone(),
            prefix: self.prefix,
            chosen,
            open: false,
        };
        let (options, selected, on_pick, key) = (self.options, self.selected, self.on_pick, self.id.to_string());
        let popover = Popover::new(self.id)
            .anchor(Anchor::TopLeft)
            .offset(px(6.))
            .trigger(trigger)
            .min_w(px(160.))
            .max_w(px(280.))
            .max_h(px(320.))
            .content(move |_, window, cx| {
                let popover = cx.entity();
                div()
                    .id("options")
                    .flex()
                    .flex_col()
                    .overflow_y_scroll()
                    .role(Role::ListBox)
                    .children(options.iter().map(|o| {
                        let on_pick = on_pick.clone();
                        let popover = popover.clone();
                        let id = o.id.clone();
                        option_row(&key, o, o.id == selected, window, cx).on_click(move |_, window, cx| {
                            on_pick(&id, window, cx);
                            popover.update(cx, |s, cx| s.dismiss(window, cx));
                        })
                    }))
            });
        layout::float(popover, p)
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
        let bg = motion::color(
            &self.id,
            "bg",
            if lit {
                p.bg_control_hover
            } else {
                Rgba {
                    a: 0.,
                    ..p.bg_control_hover
                }
            },
            window,
            cx,
        );
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
            .h(px(tokens::CONTROL_H_SM))
            .px(px(space::X2_5))
            .max_w(px(256.))
            .rounded(px(tokens::RADIUS_CONTROL))
            .bg(bg)
            .text_sm()
            .text_color(fg)
            .when_some(self.prefix, |r, icon_name| r.child(icon(icon_name, icon::MD)))
            .when_some(self.chosen.as_ref().map(|c| c.mark.clone()), |r, m| {
                r.children(mark(&format!("{}-mark", self.id), &m))
            })
            .child(div().min_w_0().truncate().child(label))
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
    let id = ElementId::from(SharedString::from(format!("{key}-option-{}", o.id)));
    let pointer = motion::pointer(&id, window, cx);
    let hovered = pointer.read(cx).hovered;
    let bg = motion::color(
        &id,
        "bg",
        if hovered {
            p.accent_soft
        } else {
            Rgba { a: 0., ..p.accent_soft }
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
