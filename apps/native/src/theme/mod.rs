// Zorel's theme for the native client (spec 019): one source, apps/web/src/styles.css, exported by
// `bun run tokens` as tokens.rs (Zorel's own components read the Palette) and themes/zorel.json (gpui-component's
// theme, so the kit's ready-made components wear the same identity). Dark only for now (no light/system choice).
// Reduced motion needs nothing here: gpui_kit::init reads the system setting into `cx.reduce_motion()`.
pub mod tokens;

use std::rc::Rc;

use gpui_kit::{
    App, Window,
    component::{Theme, ThemeMode, ThemeSet},
};
use tokens::{DARK, Palette};

const KIT_THEME: &str = include_str!("../../themes/zorel.json");

/// Zorel is dark for now (the light theme comes back with its own pass): every screen reads this palette.
pub fn palette(_: &Window) -> &'static Palette {
    &DARK
}

/// Installs Zorel's dark theme for gpui-component, so the kit's components wear it too.
pub fn install(cx: &mut App) {
    let set: ThemeSet = serde_json::from_str(KIT_THEME).expect("themes/zorel.json is a gpui-component theme set");
    let Some(dark) = set.themes.iter().find(|t| t.mode.is_dark()).cloned().map(Rc::new) else {
        return;
    };
    Theme::update(cx, |theme| theme.dark_theme = dark);
    Theme::change(ThemeMode::Dark, None, cx);
}
