// The person's interface preferences on this computer (the web keeps them in localStorage): the sidebar folded or
// not, which projects are open, which sidebar sections are closed. A small JSON file in the system's config folder;
// missing or unreadable means the defaults, and a failed write only logs (it never stops the app). One copy for the
// whole app (a GPUI global): read with `Prefs::get`, changed only with `Prefs::update`, which saves, so no screen can
// write back a stale copy over another's change.
use std::{collections::BTreeSet, path::PathBuf};

use gpui_kit::{App, BorrowAppContext, Global};
use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
    pub sidebar_folded: bool,
    pub expanded_projects: BTreeSet<String>,
    /// "chats" and/or "projects".
    pub collapsed_sections: BTreeSet<String>,
    /// The sidebar's places in the person's order (ids like "nav-home"); empty: the default order.
    pub places: Vec<String>,
    /// Full access was explained and confirmed once (it isn't asked again).
    pub full_access_confirmed: bool,
    /// The chat's side panel width (px); 0: the default.
    pub side_width: f32,
    /// "system" (or empty), "dark" or "light".
    pub theme: String,
    /// "system" (or empty), "en" or "pt-BR".
    pub language: String,
    /// A reply's live steps start folded (Settings › Live steps off).
    pub live_steps_folded: bool,
}

fn file() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("Zorel").join("native-prefs.json"))
}

impl Global for Prefs {}

impl Prefs {
    /// From disk: once at start (`run` installs it as the global).
    pub fn load() -> Self {
        file()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn get(cx: &App) -> &Self {
        cx.global()
    }

    /// Changes the app's preferences and saves them.
    pub fn update(cx: &mut App, change: impl FnOnce(&mut Self)) {
        cx.update_global(|prefs: &mut Self, _| {
            change(prefs);
            prefs.save();
        });
    }

    fn save(&self) {
        let Some(path) = file() else { return };
        let written = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|_| std::fs::write(&path, serde_json::to_string_pretty(self).unwrap_or_default()));
        if let Err(e) = written {
            eprintln!("prefs: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Prefs;

    #[test]
    fn unknown_or_missing_fields_fall_back() {
        let p: Prefs = serde_json::from_str(r#"{"sidebarFolded":true,"other":1}"#).expect("tolerant");
        assert!(p.sidebar_folded && p.expanded_projects.is_empty());
    }
}
