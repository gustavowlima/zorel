// A block of code or a command (markdown fences, a command waiting for approval): the code tone, a hairline and the
// mono face. One component so every code surface looks and later highlights the same.
use gpui_kit::*;

use crate::theme::{tokens, tokens::Palette};

/// The monospace face used for code.
pub const MONO: &str = "Menlo";

pub fn code_block(p: &Palette, text: impl Into<SharedString>) -> Div {
    div()
        .rounded(px(tokens::RADIUS_CONTROL))
        .bg(p.bg_code)
        .border_1()
        .border_color(p.border)
        .p(px(10.))
        .font_family(MONO)
        .text_size(px(12.5))
        .child(text.into())
}
