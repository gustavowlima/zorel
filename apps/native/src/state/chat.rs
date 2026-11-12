// One chat as the engine streams it (spec 019 T023): the snapshot a subscription starts with, then events folded in.
// Pure (no GPUI) so it's tested directly; the chat screen owns one and re-renders when `revision` moves.
// Rows keep the engine's ids (message, step, approval), which the list uses as stable element ids.
use std::collections::HashMap;

use crate::net::types::{Approval, ChatStatus, Message, SubscribeChatItem as Event, Turn, WorkStep};

#[derive(Default)]
pub struct ChatLog {
    pub messages: Vec<Message>,
    /// The reply being written, per turn: only this tail is re-parsed while it streams.
    pub partial: HashMap<String, String>,
    /// Steps of the turns in progress (a finished turn's steps live on its message).
    pub steps: Vec<WorkStep>,
    pub approvals: Vec<Approval>,
    pub turns: Vec<Turn>,
    pub status: Option<ChatStatus>,
    /// Moves on every change the screen draws.
    pub revision: u64,
}

impl ChatLog {
    pub fn apply(&mut self, event: Event) {
        match event {
            Event::Snapshot { snapshot: s } => {
                self.messages = s.messages;
                self.partial = s.partial.into_iter().map(|p| (p.turn_id, p.text)).collect();
                self.steps = s.steps;
                self.approvals = s.approvals;
                self.turns = s.turns;
                self.status = Some(s.status);
            }
            Event::Message { message } => self.add_message(message),
            Event::Queued { turn } | Event::TurnStarted { turn } => self.put_turn(turn),
            Event::Text { delta, turn_id } => self.partial.entry(turn_id).or_default().push_str(&delta),
            Event::StepStarted { step } | Event::StepFinished { step } => {
                match self.steps.iter_mut().find(|s| s.id == step.id) {
                    Some(known) => *known = step,
                    None => self.steps.push(step),
                }
            }
            Event::Approval { approval } => {
                self.approvals.retain(|a| a.id != approval.id);
                self.approvals.push(approval);
            }
            Event::ApprovalResolved { approval_id, .. } => self.approvals.retain(|a| a.id != approval_id),
            Event::TurnCompleted { message, turn } => self.end_turn(turn, Some(message)),
            Event::TurnFailed { message, turn } | Event::Interrupted { message, turn } => self.end_turn(turn, message),
            Event::Status { status } => self.status = Some(status),
            // ponytail: reasoning, handoffs, model switches, learning and worktrees aren't drawn by the prototype yet.
            _ => return,
        }
        self.revision += 1;
    }

    fn add_message(&mut self, message: Message) {
        if !self.messages.iter().any(|m| m.id == message.id) {
            self.messages.push(message);
        }
    }

    fn put_turn(&mut self, turn: Turn) {
        match self.turns.iter_mut().find(|t| t.id == turn.id) {
            Some(known) => *known = turn,
            None => self.turns.push(turn),
        }
    }

    fn end_turn(&mut self, turn: Turn, message: Option<Message>) {
        self.partial.remove(&turn.id);
        self.steps.retain(|s| s.turn_id != turn.id);
        self.turns.retain(|t| t.id != turn.id);
        if let Some(message) = message {
            self.add_message(message);
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn event(v: serde_json::Value) -> Event {
        serde_json::from_value(v).expect("a chat event")
    }

    fn message(id: &str, text: &str) -> serde_json::Value {
        json!({ "id": id, "chatId": "c", "role": "assistant", "text": text, "agentId": null, "accountId": null,
            "model": null, "turnId": "t", "at": 1, "attachments": [], "changes": [], "steps": [], "switches": [],
            "inputTokens": 0, "outputTokens": 0, "cost": null, "durationMs": null, "error": null, "revertedAt": null })
    }

    fn turn(state: &str) -> serde_json::Value {
        json!({ "id": "t", "chatId": "c", "state": state, "model": "anthropic/x", "agentId": null, "accountId": null,
            "clientId": null, "startedAt": null, "firstTokenAt": null, "endedAt": null, "error": null,
            "usage": { "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0 } })
    }

    #[test]
    fn a_streamed_reply_becomes_its_message() {
        let mut log = ChatLog::default();
        log.apply(event(json!({ "_tag": "turn-started", "turn": turn("running") })));
        log.apply(event(json!({ "_tag": "text", "turnId": "t", "delta": "Good " })));
        log.apply(event(json!({ "_tag": "text", "turnId": "t", "delta": "day" })));
        assert_eq!(log.partial["t"], "Good day");
        log.apply(event(
            json!({ "_tag": "turn-completed", "turn": turn("completed"), "message": message("m1", "Good day") }),
        ));
        assert!(log.partial.is_empty() && log.turns.is_empty());
        assert_eq!(log.messages.len(), 1);
        log.apply(event(json!({ "_tag": "message", "message": message("m1", "Good day") }))); // a replay: no duplicate
        assert_eq!(log.messages.len(), 1);
        assert_eq!(log.revision, 5);
    }
}
