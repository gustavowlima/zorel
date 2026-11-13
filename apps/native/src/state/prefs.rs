// The person's interface preferences on this computer (the web keeps them in localStorage): the sidebar folded or
// not, which projects are open, which sidebar sections are closed. A small JSON file in the system's config folder;
// missing or unreadable means the defaults, and a failed write only logs (it never stops the app).
use std::{collections::BTreeSet, path::PathBuf};

use serde::{Deserialize, Serialize};

/// Live steps start folded (Settings › Live steps off), read on every frame without touching the disk.
pub static STEPS_FOLDED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn steps_folded() -> bool {
    STEPS_FOLDED.load(std::sync::atomic::Ordering::Relaxed)
}

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

impl Prefs {
    pub fn load() -> Self {
        let prefs: Self = file()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        STEPS_FOLDED.store(prefs.live_steps_folded, std::sync::atomic::Ordering::Relaxed);
        prefs
    }

    pub fn save(&self) {
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
