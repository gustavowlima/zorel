// Layout pieces (apps/web/src/ui/layout.tsx): a card is the surface tone with the card radius and a hairline; a row
// sits inside it with the row radius (card radius − inset, concentric).
use gpui_kit::*;

use crate::theme::{tokens, tokens::Palette};

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
        .gap(px(8.))
        .rounded(px(tokens::RADIUS_ROW))
        .px(px(8.))
        .py(px(6.))
}
