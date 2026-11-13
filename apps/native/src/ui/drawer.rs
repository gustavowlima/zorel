// A drawer (settings that don't fit inline: an agent's profile, AI and access): the screen dims behind it, the panel
// slides in from the right on the sheet radius, with a header (a mark, the title and a line under it, Close), a body
// that scrolls in titled sections, and its actions kept at the foot. A click on the dimmed screen closes it.
// Reusable: the Builder's proposal uses it now, the agent's own page next.
use std::rc::Rc;

use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::{
        button::{Button, Size},
        motion, space,
    },
};

pub type OnClose = Rc<dyn Fn(&mut Window, &mut App) + 'static>;
/// A choice picked (its index).
pub type OnPick = Rc<dyn Fn(usize, &mut Window, &mut App) + 'static>;

/// How wide a drawer is.
pub const WIDTH: f32 = 440.;

pub struct Drawer {
    pub id: SharedString,
    pub mark: Option<AnyElement>,
    pub title: String,
    pub subtitle: Option<String>,
    pub sections: Vec<AnyElement>,
    pub actions: Vec<AnyElement>,
    pub close_label: String,
    pub on_close: OnClose,
}

impl Drawer {
    pub fn render(self, window: &Window) -> AnyElement {
        let p = theme::palette(window);
        let (backdrop_close, button_close) = (self.on_close.clone(), self.on_close.clone());
        let panel = div()
            .id(SharedString::from(format!("{}-panel", self.id)))
            .occlude()
            .w(px(WIDTH))
            .max_w_full()
            .h_full()
            .flex()
            .flex_col()
            // Full height, against the card's right edge (which rounds its outer corners).
            .rounded_l(px(tokens::RADIUS_SHEET))
            .bg(p.bg_surface)
            .border_l_1()
            .border_color(p.border_strong)
            .shadow_lg()
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(space::X3))
                    .px(px(space::X5))
                    .py(px(space::X4))
                    .border_b_1()
                    .border_color(p.border)
                    .children(self.mark)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(17.))
                                    .line_height(px(24.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .truncate()
                                    .child(self.title),
                            )
                            .when_some(self.subtitle, |c, s| {
                                c.child(div().text_sm().text_color(p.text_muted).truncate().child(s))
                            }),
                    )
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("{}-close", self.id)),
                            IconName::Close,
                            self.close_label,
                        )
                        .size(Size::Sm)
                        .on_click(move |_, window, cx| button_close(window, cx)),
                    ),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{}-body", self.id)))
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(space::X5))
                    .py(px(space::X5))
                    .flex()
                    .flex_col()
                    .gap(px(space::X6))
                    .children(self.sections),
            )
            .when(!self.actions.is_empty(), |c| {
                c.child(
                    div()
                        .flex()
                        .flex_none()
                        .justify_end()
                        .gap(px(space::X2))
                        .px(px(space::X5))
                        .py(px(space::X4))
                        .border_t_1()
                        .border_color(p.border)
                        .children(self.actions),
                )
            });
        div()
            .absolute()
            .inset_0()
            .flex()
            .justify_end()
            .child(
                // The dimmed screen: a click closes.
                div()
                    .id(SharedString::from(format!("{}-backdrop", self.id)))
                    .absolute()
                    .inset_0()
                    .bg(p.overlay)
                    .on_click(move |_, window, cx| backdrop_close(window, cx)),
            )
            .child(motion::slide_in(
                panel,
                SharedString::from(format!("{}-in", self.id)),
                motion::DRAWER_MS,
                24.,
            ))
            .into_any_element()
    }
}

/// A titled section of a drawer: its title (and a muted line), then its fields.
pub fn section(title: String, hint: Option<String>, fields: Vec<AnyElement>, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    div()
        .flex()
        .flex_col()
        .gap(px(space::X3))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X0_5))
                .child(
                    div()
                        .text_sm()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(p.text)
                        .child(title),
                )
                .when_some(hint, |c, h| c.child(div().text_sm().text_color(p.text_muted).child(h))),
        )
        .children(fields)
        .into_any_element()
}

/// One field: its label (and a muted hint) above or beside what it shows or edits.
pub fn field(label: String, hint: Option<String>, control: AnyElement, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    div()
        .flex()
        .flex_col()
        .gap(px(space::X1_5))
        .child(div().text_sm().text_color(p.text_muted).child(label))
        .child(control)
        .when_some(hint, |c, h| c.child(div().text_xs().text_color(p.text_dim).child(h)))
        .into_any_element()
}

/// A choice among a few, each with what it means (access levels): rows with a check on the chosen one.
pub fn choices(
    key: &str,
    options: Vec<(String, String)>,
    selected: usize,
    on_pick: OnPick,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let p = theme::palette(window);
    let rows: Vec<AnyElement> = options
        .into_iter()
        .enumerate()
        .map(|(i, (label, hint))| {
            let on = i == selected;
            let id = ElementId::from(SharedString::from(format!("{key}-choice-{i}")));
            let pointer = motion::pointer(&id, window, cx);
            let hovered = pointer.read(cx).hovered;
            let bg = motion::color(
                &id,
                "bg",
                if on || hovered {
                    p.bg_control
                } else {
                    motion::fade(p.bg_control, 0.)
                },
                window,
                cx,
            );
            let pick = on_pick.clone();
            let row = div()
                .id(id.clone())
                .role(Role::RadioButton)
                .aria_selected(on)
                .flex()
                .items_start()
                .gap(px(space::X2_5))
                .px(px(space::X3))
                .py(px(space::X2_5))
                .rounded(px(tokens::RADIUS_ROW))
                .border_1()
                .border_color(if on { p.accent_line } else { p.border })
                .bg(bg)
                .on_click(move |_, window, cx| pick(i, window, cx))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().font_weight(FontWeight::MEDIUM).child(label))
                        .child(div().text_sm().text_color(p.text_muted).child(hint)),
                )
                .when(on, |r| {
                    r.child(crate::ui::icon::icon(IconName::Check, crate::ui::icon::MD).text_color(p.accent_text))
                });
            motion::track(row, &pointer).into_any_element()
        })
        .collect();
    div()
        .flex()
        .flex_col()
        .gap(px(space::X1_5))
        .children(rows)
        .into_any_element()
}
