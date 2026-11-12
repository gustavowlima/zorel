// The app's menus (spec 019 T042), as the Electron app had them: an app menu, not a browser menu — macOS gets Zorel
// (hide, hide others, show all, quit), Edit (acting on the focused text field: gpui-base's input actions) and Window
// (minimize, zoom); no reload or devtools. Windows and Linux show no menu bar, as before (servers live in the tray).
use gpui_kit::{
    base::input::{Copy, Cut, Paste, Redo, SelectAll, Undo},
    *,
};

use rust_i18n::t;

fn m(key: &str) -> SharedString {
    t!(format!("desktop.menu.{key}")).into_owned().into()
}

actions!(zorel, [Quit, Hide, HideOthers, ShowAll, Minimize, Zoom]);

pub fn install(cx: &mut App) {
    cx.on_action(|_: &Quit, cx| cx.quit());
    cx.on_action(|_: &Hide, cx| cx.hide());
    cx.on_action(|_: &HideOthers, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAll, cx| cx.unhide_other_apps());
    cx.on_action(|_: &Minimize, cx| with_active_window(cx, |window| window.minimize_window()));
    cx.on_action(|_: &Zoom, cx| with_active_window(cx, |window| window.zoom_window()));
    cx.bind_keys([
        KeyBinding::new("cmd-q", Quit, None),
        KeyBinding::new("cmd-h", Hide, None),
        KeyBinding::new("alt-cmd-h", HideOthers, None),
        KeyBinding::new("cmd-m", Minimize, None),
    ]);
    if cfg!(target_os = "macos") {
        cx.set_menus(vec![
            Menu::new(t!("app.name").into_owned()).items([
                MenuItem::os_submenu(m("services"), SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action(m("hide"), Hide),
                MenuItem::action(m("hideOthers"), HideOthers),
                MenuItem::action(m("showAll"), ShowAll),
                MenuItem::separator(),
                MenuItem::action(m("quit"), Quit),
            ]),
            Menu::new(m("edit")).items([
                MenuItem::action(m("undo"), Undo),
                MenuItem::action(m("redo"), Redo),
                MenuItem::separator(),
                MenuItem::os_action(m("cut"), Cut, OsAction::Cut),
                MenuItem::os_action(m("copy"), Copy, OsAction::Copy),
                MenuItem::os_action(m("paste"), Paste, OsAction::Paste),
                MenuItem::os_action(m("selectAll"), SelectAll, OsAction::SelectAll),
            ]),
            Menu::new(m("window")).items([
                MenuItem::action(m("minimize"), Minimize),
                MenuItem::action(m("zoom"), Zoom),
            ]),
        ]);
    }
}

fn with_active_window(cx: &mut App, f: impl FnOnce(&mut Window)) {
    if let Some(handle) = cx.active_window() {
        let _ = handle.update(cx, |_, window, _| f(window));
    }
}
