// The work a reply did, as a tree (the web's ui/step-tree.tsx): a head with a chevron (a turning mark while it works)
// the trunk hangs from, and the summary in words; under it, open, one row per step: an arc from the trunk (x 8) to its
// glyph (x 24), the trunk straight through, its title in plain words from x 46, quiet facts after it (how long, that
// it failed), and its command or path in mono only on hover. The trunk runs on only while a step follows (`last`
// ends it with the arc). A row with something to show opens to it (a wash fading in from the trunk on hover, no hand
// cursor), the trunk passing beside. A note (a thought) has no glyph and no arc: its words sit in the tree.
use std::rc::Rc;

use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::{
        icon::{self, icon},
        motion, space,
    },
};

pub type OnToggle = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

/// A row's height (h-7), the trunk's x, the glyph's x and the title's x.
const ROW_H: f32 = 28.;
const TRUNK_X: f32 = 8.;
const GLYPH_X: f32 = 24.;
const TEXT_X: f32 = 46.;
/// The arc: from the trunk to the glyph's middle, its corner rounded.
const ARC_W: f32 = 12.;
const ARC_R: f32 = 8.;

/// The head: chevron (or `leading` while it works), the summary pieces; open with rows, the trunk starts under it.
pub struct Head {
    pub key: String,
    pub open: bool,
    /// Any steps under it yet (a turn just started has none: no trunk to draw).
    pub rows: bool,
    pub leading: Option<AnyElement>,
    pub parts: Vec<AnyElement>,
    pub on_toggle: OnToggle,
}

pub fn head(h: Head, window: &mut Window, cx: &mut App) -> AnyElement {
    let Head {
        key,
        open,
        rows,
        leading,
        parts: children,
        on_toggle,
    } = h;
    let p = theme::palette(window);
    let id = ElementId::from(format!("tree-head-{key}"));
    let pointer = motion::pointer(&id, window, cx);
    let hovered = pointer.read(cx).hovered;
    let fg = motion::color(
        &id,
        "fg",
        if hovered { p.text_secondary } else { p.text_muted },
        window,
        cx,
    );
    let turn = gpui_kit::base::spring(
        SharedString::from(format!("tree-turn-{key}")),
        px(if open { 90. } else { 0. }),
        motion::settle(motion::SETTLE_MS),
        window,
        cx,
    );
    let mark = leading.unwrap_or_else(|| {
        icon(IconName::ChevronRight, icon::XS)
            .text_color(p.text_dim)
            .rotate(radians(f32::from(turn).to_radians()))
            .into_any_element()
    });
    let head = div()
        .id(id)
        .role(Role::Button)
        .aria_expanded(open)
        .relative()
        .flex()
        .items_center()
        .gap(px(space::X2))
        .h(px(ROW_H))
        .max_w_full()
        .min_w_0()
        .pr(px(space::X2_5))
        .text_sm()
        .text_color(fg)
        .child(div().flex_none().w(px(icon::MD)).flex().justify_center().child(mark))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(space::X1_5))
                .min_w_0()
                .children(children),
        )
        .when(open && rows, |h| {
            h.child(
                div()
                    .absolute()
                    .top(px(20.))
                    .bottom_0()
                    .left(px(TRUNK_X))
                    .w(px(1.))
                    .bg(p.border_strong),
            )
        })
        .on_click(move |_, window, cx| on_toggle(window, cx));
    motion::track(head, &pointer).into_any_element()
}

/// The steps under an open head, one after another.
pub fn list(children: Vec<AnyElement>) -> Div {
    div().flex().flex_col().children(children)
}

/// What a row's glyph and title say about how it went.
#[derive(Clone, Copy, PartialEq)]
pub enum Tone {
    Default,
    Danger,
    Warning,
}

pub struct Row {
    pub key: String,
    pub icon: AnyElement,
    pub tone: Tone,
    pub title: String,
    /// After the title, quiet: how long, that it failed or waits.
    pub facts: Vec<AnyElement>,
    /// The command, path or URL, shown on hover.
    pub hint: Option<String>,
    pub last: bool,
    pub open: bool,
    /// The row opens to `body` (None: nothing to open).
    pub on_toggle: Option<OnToggle>,
    pub body: Vec<AnyElement>,
}

impl Row {
    pub fn render(self, window: &mut Window, cx: &mut App) -> AnyElement {
        let p = theme::palette(window);
        let strong = p.border_strong;
        let tone = match self.tone {
            Tone::Default => p.text_dim,
            Tone::Danger => p.danger,
            Tone::Warning => p.warning,
        };
        let id = ElementId::from(format!("tree-row-{}", self.key));
        let pointer = motion::pointer(&id, window, cx);
        let hovered = pointer.read(cx).hovered;
        let opens = self.on_toggle.is_some();
        // The hint and the wash ease in with the pointer.
        let lit = gpui_kit::base::transition(
            ElementId::from(format!("tree-lit-{}", self.key)),
            if hovered { 1. } else { 0. },
            gpui_kit::base::Transition::new(motion::ms(motion::HOVER_MS)),
            window,
            cx,
        );
        let wash = motion::fade(p.bg_control_hover, lit);
        let line = div()
            .id(id)
            .relative()
            .flex()
            .items_center()
            .gap(px(space::X2))
            .w_full()
            .min_w_0()
            .min_h(px(ROW_H))
            .pl(px(TEXT_X))
            .pr(px(space::X2_5))
            .rounded(px(tokens::RADIUS_CONTROL))
            .when(opens, |r| {
                r.role(Role::Button).aria_expanded(self.open).bg(linear_gradient(
                    90.,
                    linear_color_stop(motion::fade(wash, 0.), 0.12),
                    linear_color_stop(wash, 0.5),
                ))
            })
            .child(
                div()
                    .absolute()
                    .top(px(6.))
                    .left(px(GLYPH_X))
                    .size(px(icon::MD))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(tone)
                    .child(self.icon),
            )
            .child(
                div()
                    .min_w_0()
                    .flex_shrink(1.)
                    .truncate()
                    .text_color(if opens && self.open { p.text } else { p.text_secondary })
                    .child(self.title),
            )
            .when(!self.facts.is_empty(), |r| {
                r.child(
                    div()
                        .flex_none()
                        .flex()
                        .items_center()
                        .gap(px(space::X2))
                        .text_xs()
                        .text_color(p.text_dim)
                        .children(self.facts),
                )
            })
            .when_some(self.hint, |r, hint| {
                r.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .font_family(crate::ui::code::MONO)
                        .text_xs()
                        .text_color(p.text_dim)
                        .opacity(lit)
                        .child(hint),
                )
            })
            .when_some(self.on_toggle, |r, toggle| {
                r.on_click(move |_, window, cx| toggle(window, cx))
            });
        let line = motion::track(line, &pointer);
        let body = (self.open && !self.body.is_empty()).then(|| {
            motion::enter(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1_5))
                    .pt(px(space::X0_5))
                    .pr(px(space::X2_5))
                    .pb(px(space::X2_5))
                    .pl(px(TEXT_X))
                    .children(self.body),
                SharedString::from(format!("tree-body-{}", self.key)),
                motion::MENU_IN_MS,
                4.,
            )
        });
        // The trunk runs straight through every step but the last, an arc branching off it to the glyph's middle;
        // the last step's arc comes down from its top instead, where the trunk ends.
        let arc = |top: f32, h: f32| {
            div()
                .absolute()
                .top(px(top))
                .left(px(TRUNK_X))
                .w(px(ARC_W))
                .h(px(h))
                .border_l_1()
                .border_b_1()
                .border_color(strong)
                .rounded_bl(px(ARC_R))
        };
        div()
            .relative()
            .map(|d| {
                if self.last {
                    d.child(arc(0., 14.))
                } else {
                    d.child(
                        div()
                            .absolute()
                            .top_0()
                            .bottom_0()
                            .left(px(TRUNK_X))
                            .w(px(1.))
                            .bg(strong),
                    )
                    .child(arc(6., 8.))
                }
            })
            .child(line)
            .children(body)
            .into_any_element()
    }
}

/// A thought: its words in the tree, two lines at most; the trunk passes it only on its way to a step below.
pub fn note(text: String, last: bool, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    div()
        .relative()
        .py(px(space::X1))
        .pr(px(space::X2_5))
        .pl(px(GLYPH_X))
        .text_sm()
        .text_color(p.text_dim)
        .when(!last, |d| {
            d.child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(TRUNK_X))
                    .w(px(1.))
                    .bg(p.border_strong),
            )
        })
        .child(div().line_clamp(2).child(text))
        .into_any_element()
}
