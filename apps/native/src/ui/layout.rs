// Layout pieces (apps/web/src/ui/layout.tsx): a card is the surface tone with the card radius and a hairline; a row
// sits inside it with the row radius (card radius − inset, concentric).
use gpui_kit::*;

use crate::theme::{tokens, tokens::Palette};
use crate::ui::space;

pub fn card(p: &Palette) -> Div {
    div()
        .rounded(px(tokens::RADIUS_CARD))
        .bg(p.bg_surface)
        .border_1()
        .border_color(p.border)
        .p(px(tokens::INSET_CARD))
}

pub fn row() -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(space::X2))
        .rounded(px(tokens::RADIUS_ROW))
        .px(px(space::X2))
        .py(px(space::X1_5))
}

/// The one floating panel every menu, select, dropdown and popover draws (the context menu's look): `float` on a
/// stateful box that takes the pointer. Open it with the kit's Popover at `appearance(false)` (the kit's own ring and
/// padding would double the border) and let it enter with `motion::enter(.., MENU_IN_MS, ..)`.
pub fn panel(id: impl Into<ElementId>, p: &Palette) -> Stateful<Div> {
    float(div().id(id), p).occlude()
}

/// What floats over the page (menus, selects, popovers; web `rounded-card border-strong p-inset`, on the surface tone): the card
/// radius with the card inset, so the rows inside (row radius) are concentric with it. The kit's popover keeps its
/// shadow and motion; this only sets Zorel's geometry and colours.
pub fn float<S: Styled>(surface: S, p: &Palette) -> S {
    surface
        .rounded(px(tokens::RADIUS_CARD))
        .p(px(tokens::INSET_CARD))
        .border_1()
        .border_color(p.border_strong)
        .bg(p.bg_surface) // the cards' tone: in harmony with the frame and the canvas (no backdrop blur here)
}

/// A titled block of a screen (Home's Needs you, the agents by project): the title (and a muted hint under it), an
/// action on the right, then the body.
pub fn section(
    p: &Palette,
    title: String,
    hint: Option<String>,
    action: Option<AnyElement>,
    body: impl IntoElement,
) -> Div {
    use gpui_kit::prelude::FluentBuilder as _;
    div()
        .flex()
        .flex_col()
        .gap(px(space::X2_5))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(space::X3))
                .min_h(px(space::X6))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(div().font_weight(FontWeight::SEMIBOLD).text_color(p.text).child(title))
                        .when_some(hint, |c, h| c.child(div().text_sm().text_color(p.text_muted).child(h))),
                )
                .children(action),
        )
        .child(body)
}

/// A card that holds rows (a list in a section).
pub fn rows(p: &Palette) -> Div {
    card(p).flex().flex_col().gap(px(space::X0_5))
}
