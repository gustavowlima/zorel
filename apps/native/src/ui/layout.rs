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
