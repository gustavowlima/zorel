// Zorel's theme for the native client (spec 019 T025): the palette follows the window's appearance (the system's
// light/dark), the tokens come from apps/web/src/styles.css (scripts/export-tokens.ts). Reduced motion needs nothing
// here: gpui_kit::init reads the system setting into `cx.reduce_motion()`, which every gpui-base transition and
// spring already honours. ponytail: no in-app light/dark override yet (the web's Settings › Appearance); add when
// the settings screen lands.
pub mod tokens;

use gpui_kit::{Window, WindowAppearance};
use tokens::{DARK, LIGHT, Palette};

pub fn palette(window: &Window) -> &'static Palette {
    match window.appearance() {
        WindowAppearance::Dark | WindowAppearance::VibrantDark => &DARK,
        WindowAppearance::Light | WindowAppearance::VibrantLight => &LIGHT,
    }
}
