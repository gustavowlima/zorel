// Zorel's theme for the native client (spec 019): one source, apps/web/src/styles.css, exported by
// `bun run tokens` as tokens.rs (Zorel's own components read the Palette) and themes/zorel.json (gpui-component's
// theme, so the kit's ready-made components wear the same identity). Both follow the window's light/dark. Reduced
// motion needs nothing here: gpui_kit::init reads the system setting into `cx.reduce_motion()`.
// ponytail: no in-app light/dark override yet (the web's Settings › Appearance); add with the settings screen.
pub mod tokens;

use std::rc::Rc;

use gpui_kit::{
    App, Window, WindowAppearance,
    component::{Theme, ThemeSet},
};
use tokens::{DARK, LIGHT, Palette};

const KIT_THEME: &str = include_str!("../../themes/zorel.json");

pub fn palette(window: &Window) -> &'static Palette {
    match window.appearance() {
        WindowAppearance::Dark | WindowAppearance::VibrantDark => &DARK,
        WindowAppearance::Light | WindowAppearance::VibrantLight => &LIGHT,
    }
}

/// Installs Zorel's light and dark themes for gpui-component and follows the system's appearance.
pub fn install(cx: &mut App) {
    let set: ThemeSet = serde_json::from_str(KIT_THEME).expect("themes/zorel.json is a gpui-component theme set");
    let pick = |dark: bool| {
        set.themes
            .iter()
            .find(|t| t.mode.is_dark() == dark)
            .cloned()
            .map(Rc::new)
    };
    let (Some(light), Some(dark)) = (pick(false), pick(true)) else {
        return;
    };
    Theme::update(cx, |theme| {
        theme.light_theme = light;
        theme.dark_theme = dark;
    });
    Theme::sync_system_appearance(None, cx);
}

/// Re-reads the system's light/dark into the kit's theme (call when the window's appearance changes).
pub fn follow_system(window: &mut Window, cx: &mut App) {
    Theme::sync_system_appearance(Some(window), cx);
}
