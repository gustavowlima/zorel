// One chat as the engine streams it (spec 019 T023): the snapshot a subscription starts with, then events folded in.
// Pure (no GPUI) so it's tested directly; the chat screen owns one and re-renders when `revision` moves.
// Rows keep the engine's ids (message, step, approval), which the list uses as stable element ids.
use std::collections::HashMap;

use crate::net::types::{
    Approval, ChatStatus, Message, SubscribeChatItem as Event, SubscribeChatItemVia as Via, Switch, Turn, WorkStep,
};

/// What happens between messages and isn't stored as one (this session only): who passed the turn to whom, a
/// failover move in a running turn (the saved reply carries it after), an agent moved to its own copy.
#[derive(Clone, Debug)]
pub enum Note {
    Handoff {
        at: f64,
        from: Option<String>,
        to: Vec<String>,
        via: Via,
        reason: Option<String>,
    },
    Failover {
        at: f64,
        turn_id: String,
        switch: Switch,
    },
    Worktree {
        at: f64,
        agent_id: String,
        branch: String,
    },
}

/// A decided approval or question: the request, what was decided, and what you said with it.
#[derive(Clone, Debug)]
pub struct Receipt {
    pub approval: Approval,
    pub outcome: crate::net::types::SubscribeChatItemOutcome,
    pub reason: Option<String>,
}

impl Note {
    pub fn at(&self) -> f64 {
        match self {
            Note::Handoff { at, .. } | Note::Failover { at, .. } | Note::Worktree { at, .. } => *at,
        }
    }
}

#[derive(Default)]
pub struct ChatLog {
    pub messages: Vec<Message>,
    /// The reply being written, per turn: only this tail is re-parsed while it streams.
    pub partial: HashMap<String, String>,
    /// Steps of the turns in progress (a finished turn's steps live on its message).
    pub steps: Vec<WorkStep>,
    pub approvals: Vec<Approval>,
    pub notes: Vec<Note>,
    /// What you decided in the turns running now (shown under their reply until it ends).
    pub receipts: Vec<Receipt>,
    /// What each turn in progress is thinking (its words, when the engine shows them), and whether it is thinking
    /// now: from a reasoning sign until its next text or step.
    pub thought: HashMap<String, Thought>,
    /// Where each live step began in its turn's text (characters written before it), to cut the text there.
    pub step_at: HashMap<String, usize>,
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
            Event::Text { delta, turn_id } => {
                self.stop_thinking(&turn_id);
                self.partial.entry(turn_id).or_default().push_str(&delta)
            }
            Event::Reasoning { delta, turn_id } => {
                let t = self.thought.entry(turn_id).or_default();
                if !t.now {
                    t.since = crate::format::now_ms();
                }
                t.now = true;
                t.text.push_str(&delta);
            }
            Event::StepStarted { step } | Event::StepFinished { step } => {
                self.stop_thinking(&step.turn_id);
                let written = self.partial.get(&step.turn_id).map_or(0, |t| t.chars().count());
                self.step_at.entry(step.id.clone()).or_insert(written);
                match self.steps.iter_mut().find(|s| s.id == step.id) {
                    Some(known) => *known = step,
                    None => self.steps.push(step),
                }
            }
            Event::Approval { approval } => {
                self.approvals.retain(|a| a.id != approval.id);
                self.approvals.push(approval);
            }
            Event::ApprovalResolved {
                approval_id,
                outcome,
                reason,
                ..
            } => {
                if let Some(at) = self.approvals.iter().position(|a| a.id == approval_id) {
                    let approval = self.approvals.remove(at);
                    self.receipts.push(Receipt {
                        approval,
                        outcome,
                        reason,
                    });
                }
            }
            Event::TurnCompleted { message, turn } => self.end_turn(turn, Some(message)),
            Event::TurnFailed { message, turn } | Event::Interrupted { message, turn } => self.end_turn(turn, message),
            Event::Status { status } => self.status = Some(status),
            Event::Handoff {
                from, to, via, reason, ..
            } => self.notes.push(Note::Handoff {
                at: crate::format::now_ms(),
                from,
                to,
                via,
                reason,
            }),
            Event::Failover { turn_id, switch } => {
                // The turn starts over on the next model: what it had written goes.
                self.partial.remove(&turn_id);
                self.steps.retain(|s| s.turn_id != turn_id);
                self.notes.push(Note::Failover {
                    at: crate::format::now_ms(),
                    turn_id,
                    switch,
                })
            }
            Event::Worktree { agent_id, worktree, .. } => self.notes.push(Note::Worktree {
                at: crate::format::now_ms(),
                agent_id,
                branch: worktree.branch,
            }),
            // ponytail: handoffs, model switches, learning and worktrees aren't drawn by the prototype yet.
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

    fn stop_thinking(&mut self, turn_id: &str) {
        if let Some(t) = self.thought.get_mut(turn_id).filter(|t| t.now) {
            t.now = false;
            t.took += crate::format::now_ms() - t.since;
        }
    }

    fn end_turn(&mut self, turn: Turn, message: Option<Message>) {
        self.partial.remove(&turn.id);
        self.thought.remove(&turn.id);
        self.receipts
            .retain(|r| r.approval.turn_id.as_deref() != Some(turn.id.as_str()));
        // A failover now lives on the saved message (its switches).
        self.notes
            .retain(|n| !matches!(n, Note::Failover { turn_id, .. } if *turn_id == turn.id));
        let ended: Vec<String> = self
            .steps
            .iter()
            .filter(|s| s.turn_id == turn.id)
            .map(|s| s.id.clone())
            .collect();
        for id in ended {
            self.step_at.remove(&id);
        }
        self.steps.retain(|s| s.turn_id != turn.id);
        self.turns.retain(|t| t.id != turn.id);
        if let Some(message) = message {
            self.add_message(message);
        }
    }
}

/// A turn's live reasoning: its words so far, whether it is thinking now and since when (ms).
#[derive(Default, Clone)]
pub struct Thought {
    pub text: String,
    pub now: bool,
    pub since: f64,
    /// How long it thought, summed over its finished stretches (ms).
    pub took: f64,
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
        log.apply(event(
            json!({ "_tag": "message", "message": message("m1", "Good day") }),
        )); // a replay: no duplicate
        assert_eq!(log.messages.len(), 1);
        assert_eq!(log.revision, 5);
    }

    #[test]
    fn notes_come_between_messages_and_a_failover_ends_with_its_turn() {
        let mut log = ChatLog::default();
        log.apply(event(json!({ "_tag": "turn-started", "turn": turn("running") })));
        log.apply(event(
            json!({ "_tag": "handoff", "turnId": "t", "from": "a", "to": ["b"], "via": "mention" }),
        ));
        log.apply(event(json!({ "_tag": "failover", "turnId": "t", "switch": {
            "fromModel": "claude-cli/opus", "fromAccountId": null, "toModel": "codex-cli/gpt", "toAccountId": null,
            "reason": "timeout", "until": null, "at": 1 } })));
        assert_eq!(log.notes.len(), 2);
        log.apply(event(
            json!({ "_tag": "turn-completed", "turn": turn("completed"), "message": message("m1", "ok") }),
        ));
        // The failover now lives on the saved message; the handoff stays.
        assert!(matches!(log.notes.as_slice(), [Note::Handoff { .. }]));
    }

    #[test]
    fn a_thought_lasts_until_the_next_text() {
        let mut log = ChatLog::default();
        log.apply(event(json!({ "_tag": "turn-started", "turn": turn("running") })));
        log.apply(event(
            json!({ "_tag": "reasoning", "turnId": "t", "delta": "Weighing " }),
        ));
        log.apply(event(json!({ "_tag": "reasoning", "turnId": "t", "delta": "options" })));
        assert!(log.thought["t"].now && log.thought["t"].text == "Weighing options");
        log.apply(event(json!({ "_tag": "text", "turnId": "t", "delta": "Hi" })));
        assert!(!log.thought["t"].now);
    }
}
