// System notifications (spec 019 T043), the web's rules (apps/web/src/features/notify.tsx): a chat that starts waiting
// for you, fails, or finishes while you look elsewhere; a routine's notice (its run found something or needs you).
// Routine chats don't notify on their states — their notices do. Clicking one brings Zorel forward and opens that chat.
// notify-rust shows them natively on all three systems; `wait_for_action` blocks, so each waits on its own thread.
// ponytail: on by default with no in-app switch or chime yet (Settings › General arrives with T056); macOS shows them
// only for a signed bundle (T048).
use std::collections::{HashMap, HashSet};

use tokio::sync::mpsc;

use crate::net::types::{ChatStatusState as State, Notice, NoticeOutcome};

#[derive(Debug, PartialEq, Eq)]
pub enum Moment {
    Waiting,
    Failed,
    Done,
}

/// What a status change is worth telling (labels.ts `noteworthy`).
pub fn noteworthy(before: Option<&State>, now: &State) -> Option<Moment> {
    match (before, now) {
        (Some(b), n) if b == n => None,
        (_, State::Waiting) => Some(Moment::Waiting),
        (_, State::Failed) => Some(Moment::Failed),
        (Some(State::Running), State::Idle) => Some(Moment::Done),
        _ => None,
    }
}

/// Remembers each chat's last state and which chats belong to routines.
#[derive(Default)]
pub struct Notifier {
    last: HashMap<String, State>,
    pub routine_chats: HashSet<String>,
}

impl Notifier {
    /// The moment to notify for this chat's new state, if any (the state is remembered either way).
    pub fn moment(&mut self, chat_id: &str, state: State) -> Option<Moment> {
        let moment = noteworthy(self.last.get(chat_id), &state);
        self.last.insert(chat_id.to_string(), state);
        moment.filter(|_| !self.routine_chats.contains(chat_id))
    }
}

/// The body of a routine's notice.
pub fn notice_body(notice: &Notice) -> String {
    match notice.outcome {
        NoticeOutcome::Needs => rust_i18n::t!("notify.routineNeeds", text = notice.text).into_owned(),
        _ => notice.text.clone(),
    }
}

/// Shows a notification; a click sends `chat_id` to `clicked`.
pub fn show(title: String, body: String, chat_id: String, clicked: mpsc::UnboundedSender<String>) {
    if !can_notify() {
        return;
    }
    std::thread::spawn(move || {
        let shown = notify_rust::Notification::new()
            .appname("Zorel")
            .summary(&title)
            .body(&body)
            .show();
        match shown {
            Ok(handle) => handle.wait_for_action(|action| {
                if action != "__closed" {
                    let _ = clicked.send(chat_id);
                }
            }),
            Err(e) => eprintln!("notification: {e}"),
        }
    });
}

/// macOS delivers notifications for an app bundle only: from a bare binary (cargo run) notify-rust falls back to an
/// app named "use_default" and macOS asks the person where that app is. So outside a .app it stays silent.
// ponytail: the packaged app (T048) carries its own bundle identifier; notifications work there.
fn can_notify() -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    let bundled = std::env::current_exe()
        .map(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"))
        .unwrap_or(false);
    if !bundled {
        eprintln!("notification skipped: not running from an app bundle");
        return false;
    }
    // Inside a bundle notify-rust still needs the bundle's identifier, or it asks for "use_default" too.
    static SET: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *SET.get_or_init(|| match bundle_identifier() {
        #[cfg(target_os = "macos")]
        Some(id) => notify_rust::set_application(&id).is_ok(),
        _ => false,
    })
}

/// CFBundleIdentifier from the running bundle's Info.plist.
fn bundle_identifier() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let plist = std::fs::read_to_string(exe.parent()?.parent()?.join("Info.plist")).ok()?;
    let after = plist.split("<key>CFBundleIdentifier</key>").nth(1)?;
    let value = after.split("<string>").nth(1)?.split("</string>").next()?;
    Some(value.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{Moment, Notifier, State, noteworthy};

    #[test]
    fn moments_follow_the_web() {
        assert_eq!(noteworthy(None, &State::Waiting), Some(Moment::Waiting));
        assert_eq!(noteworthy(Some(&State::Running), &State::Idle), Some(Moment::Done));
        assert_eq!(noteworthy(Some(&State::Idle), &State::Idle), None);
        assert_eq!(noteworthy(None, &State::Idle), None);
        let mut n = Notifier::default();
        n.routine_chats.insert("r".into());
        assert_eq!(n.moment("r", State::Failed), None); // a routine's chat tells through its notices
        assert_eq!(n.moment("c", State::Failed), Some(Moment::Failed));
        assert_eq!(n.moment("c", State::Failed), None);
    }
}
