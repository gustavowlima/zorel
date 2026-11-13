// Zorel's theme for the native client (spec 019): one source, apps/web/src/styles.css, exported by
// `bun run tokens` as tokens.rs (Zorel's own components read the Palette) and themes/zorel.json (gpui-component's
// theme, so the kit's ready-made components wear the same identity). Both follow the window's light/dark. Reduced
// motion needs nothing here: gpui_kit::init reads the system setting into `cx.reduce_motion()`.
// Settings › Theme can hold it on light or dark instead of the system's (prefs.theme), for both at once.
pub mod tokens;

use std::{
    rc::Rc,
    sync::atomic::{AtomicU8, Ordering},
};

use gpui_kit::{
    App, Window, WindowAppearance,
    component::{Theme, ThemeSet},
};
use tokens::{DARK, LIGHT, Palette};

const KIT_THEME: &str = include_str!("../../themes/zorel.json");

/// 0: follow the system, 1: dark, 2: light.
static CHOICE: AtomicU8 = AtomicU8::new(0);

fn choice_of(pref: &str) -> u8 {
    match pref {
        "dark" => 1,
        "light" => 2,
        _ => 0,
    }
}

pub fn palette(window: &Window) -> &'static Palette {
    match CHOICE.load(Ordering::Relaxed) {
        1 => &DARK,
        2 => &LIGHT,
        _ => match window.appearance() {
            WindowAppearance::Dark | WindowAppearance::VibrantDark => &DARK,
            WindowAppearance::Light | WindowAppearance::VibrantLight => &LIGHT,
        },
    }
}

/// Holds the theme on "dark" or "light", or follows the system ("system"); every window repaints at once.
pub fn set_choice(pref: &str, window: Option<&mut Window>, cx: &mut App) {
    CHOICE.store(choice_of(pref), Ordering::Relaxed);
    match choice_of(pref) {
        1 => Theme::change(gpui_kit::component::ThemeMode::Dark, window, cx),
        2 => Theme::change(gpui_kit::component::ThemeMode::Light, window, cx),
        _ => Theme::sync_system_appearance(window, cx),
    }
    cx.refresh_windows();
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
    set_choice(&crate::state::prefs::Prefs::load().theme, None, cx);
}

/// Re-reads the system's light/dark into the kit's theme (call when the window's appearance changes).
pub fn follow_system(window: &mut Window, cx: &mut App) {
    if CHOICE.load(Ordering::Relaxed) == 0 {
        Theme::sync_system_appearance(Some(window), cx);
    }
}
