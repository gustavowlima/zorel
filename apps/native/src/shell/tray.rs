// The tray icon (spec 019 T041), as Electron had it: Windows and Linux only (macOS keeps Zorel in the Dock). "Open
// Zorel" and a click bring the window back (closing it never quits: the engine keeps working); Quit quits.
// gpui-tray draws natively on each system on GPUI's own loop (no GTK). Servers join the menu with T047.
use gpui_kit::*;
use gpui_tray::{Icon, Tray};
use rust_i18n::t;

use crate::shell::menus::Quit;

actions!(zorel, [OpenZorel]);

const ICON: &[u8] = include_bytes!("../../assets/tray.png");

/// Builds the tray; keep the returned value alive for as long as the icon should show.
pub fn install(cx: &mut App) -> Option<Tray> {
    if cfg!(target_os = "macos") {
        return None;
    }
    let decoded = image::load_from_memory_with_format(ICON, image::ImageFormat::Png)
        .ok()?
        .to_rgba8();
    let (w, h) = decoded.dimensions();
    let tray = Icon::from_rgba(decoded.into_raw(), w, h).build().and_then(|icon| {
        Tray::builder()
            .icon(icon)
            .title("Zorel")
            .tooltip("Zorel")
            .on_activate(OpenZorel)
            .menu(|_| {
                vec![
                    MenuItem::action(t!("desktop.tray.open").into_owned(), OpenZorel),
                    MenuItem::separator(),
                    MenuItem::action(t!("desktop.menu.quit").into_owned(), Quit),
                ]
            })
            .build(cx)
    });
    tray.map_err(|e| eprintln!("tray: {e}")).ok()
}
