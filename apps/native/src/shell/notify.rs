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
