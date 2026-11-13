// An agent's session in this chat, in a drawer that fills the card's height: opened from a member's name in the
// header's list (screens/members.rs › Picker). On top its face, name and what it does now (working on its current
// step, waiting for you or for another agent, its last reply, or that it hasn't replied); then everything it did here,
// drawn exactly as the timeline draws it (its replies, its live turn); Make lead and Remove at the foot.
use super::*;

use crate::{screens::chat_actions, ui::drawer};

/// What an agent is doing in this chat right now.
#[derive(Debug, PartialEq)]
pub(super) enum Activity {
    /// A turn of its own runs: its id, what it does now (the running step), since when.
    Working {
        turn_id: String,
        doing: Option<String>,
        since: Option<f64>,
    },
    /// One of its steps waits for your OK or your answer.
    NeedsYou,
    /// It waits for other agents (their ids).
    WaitsFor(Vec<String>),
    /// Its last reply: where it is in the messages, and when.
    Replied {
        index: usize,
        at: f64,
    },
    Never,
}

/// What `agent_id` is doing, read from the chat's log.
pub(super) fn activity(agent_id: &str, log: &ChatLog) -> Activity {
    let mine = |id: &Option<String>| id.as_deref() == Some(agent_id);
    if let Some(turn) = log
        .turns
        .iter()
        .rev()
        .find(|t| mine(&t.agent_id) && t.ended_at.is_none())
    {
        if log.approvals.iter().any(|a| mine(&a.agent_id)) {
            return Activity::NeedsYou;
        }
        let doing = log
            .steps
            .iter()
            .rev()
            .find(|s| s.turn_id == turn.id && matches!(s.status, WorkStepStatus::Running))
            .map(|s| s.title.clone());
        return Activity::Working {
            turn_id: turn.id.clone(),
            doing,
            since: turn.started_at,
        };
    }
    if let Some(wait) = log
        .status
        .as_ref()
        .and_then(|s| s.waits.iter().find(|w| w.agent_id == agent_id))
    {
        return Activity::WaitsFor(wait.on.clone());
    }
    match log
        .messages
        .iter()
        .rposition(|m| matches!(m.role, MessageRole::Assistant) && mine(&m.agent_id))
    {
        Some(index) => Activity::Replied {
            index,
            at: log.messages[index].at,
        },
        None => Activity::Never,
    }
}

impl ChatScreen {
    /// Opens an agent's session in this chat (picked in the header's list).
    pub fn open_session(&mut self, agent_id: String, cx: &mut Context<Self>) {
        self.crew_agent = Some(agent_id);
        cx.notify();
    }

    /// The drawer, while an agent's session is open: its face, name and what it does now on top, then everything it
    /// did in this chat as the timeline draws it (its replies, its live turn), filling the drawer; Make lead and
    /// Remove at the foot.
    pub(super) fn crew_drawer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let agent_id = self.crew_agent.clone()?;
        let p = theme::palette(window);
        let (agent, tone, ids, lead_state) = {
            let store = self.store.read(cx);
            let chat = store.chat(&self.chat_id)?;
            let agent = store.agent(&agent_id)?.clone();
            (
                agent,
                store.tone(Some(&agent_id)),
                chat.agent_ids.clone(),
                crate::screens::sidebar::face_state(store.status(&self.chat_id)),
            )
        };
        let i = ids.iter().position(|x| *x == agent_id).unwrap_or(usize::MAX);
        let (now, l) = (format::now_ms(), format::lang());
        let doing = activity(&agent_id, &self.log);
        let (state, line) = match &doing {
            Activity::Working { doing, since, .. } => {
                let what = doing.clone().unwrap_or_else(|| t!("activity.working").into_owned());
                let line = match since.filter(|s| now - s >= 5000.) {
                    Some(s) => format!("{what} · {}", format::duration(now - s, l)),
                    None => what,
                };
                (FaceState::Working, line)
            }
            Activity::NeedsYou => (
                FaceState::Waiting,
                t!("status.waiting", agent = agent.name).into_owned(),
            ),
            Activity::WaitsFor(on) => {
                let store = self.store.read(cx);
                let others: Vec<String> = on.iter().map(|id| store.agent_name(Some(id))).collect();
                (
                    FaceState::Waiting,
                    t!("status.waitsFor", agent = agent.name, other = format::list(&others, l)).into_owned(),
                )
            }
            Activity::Replied { at, .. } => (
                if i == 0 && lead_state == FaceState::Failed {
                    FaceState::Failed
                } else {
                    FaceState::Idle
                },
                t!("team.lastReply", age = format::age(*at, now, l)).into_owned(),
            ),
            Activity::Never => (FaceState::Idle, t!("team.noReplies").into_owned()),
        };
        // Its session: each of its replies, then its turns running now.
        let mine: Vec<usize> = (0..self.log.messages.len())
            .filter(|&n| {
                let m = &self.log.messages[n];
                matches!(m.role, MessageRole::Assistant) && m.agent_id.as_deref() == Some(agent_id.as_str())
            })
            .collect();
        let live: Vec<String> = self
            .log
            .turns
            .iter()
            .filter(|t| t.agent_id.as_deref() == Some(agent_id.as_str()))
            .map(|t| t.id.clone())
            .collect();
        let mut session: Vec<AnyElement> = Vec::new();
        for n in mine {
            let m = self.log.messages[n].clone();
            session.push(self.reply_row(n, &m, window, cx));
        }
        for turn in live {
            session.push(self.live_row(&turn, window, cx));
        }
        if session.is_empty() {
            session.push(
                div()
                    .text_sm()
                    .text_color(p.text_dim)
                    .child(t!("team.sessionEmpty").into_owned())
                    .into_any_element(),
            );
        }
        let mut actions: Vec<AnyElement> = Vec::new();
        if i > 0 && i != usize::MAX {
            let order: Vec<String> = std::iter::once(agent_id.clone())
                .chain(ids.iter().filter(|x| **x != agent_id).cloned())
                .collect();
            let (store, chat_id, model) = (self.store.clone(), self.chat_id.clone(), agent.model.clone());
            actions.push(
                Button::new("session-lead", t!("team.makeLead").into_owned())
                    .variant(Variant::Ghost)
                    .size(Size::Sm)
                    // The lead's model drives the chat, so it follows the new lead.
                    .on_click(move |_, _, cx| {
                        chat_actions::set_team(&store, &chat_id, order.clone(), Some(model.clone()), cx)
                    })
                    .into_any_element(),
            );
        }
        // A chat always keeps one agent: the last one can't be removed, only swapped for another.
        if ids.len() > 1 && i != usize::MAX {
            let rest: Vec<String> = ids.iter().filter(|x| **x != agent_id).cloned().collect();
            let (store, chat_id, view) = (self.store.clone(), self.chat_id.clone(), cx.entity().downgrade());
            actions.push(
                Button::new("session-remove", t!("common.remove").into_owned())
                    .icon(IconName::X)
                    .name(t!("team.removeMember", name = agent.name).into_owned())
                    .variant(Variant::Ghost)
                    .size(Size::Sm)
                    .on_click(move |_, _, cx| {
                        chat_actions::set_team(&store, &chat_id, rest.clone(), None, cx);
                        let _ = view.update(cx, |this, cx| {
                            this.crew_agent = None;
                            cx.notify();
                        });
                    })
                    .into_any_element(),
            );
        }
        let view = cx.entity().downgrade();
        Some(
            drawer::Drawer {
                id: SharedString::from(format!("session-{}-{agent_id}", self.chat_id)),
                mark: Some(
                    AgentFace::new(SharedString::from(format!("session-face-{agent_id}")), tone)
                        .size(36.)
                        .state(state)
                        .into_any_element(),
                ),
                title: agent.name.clone(),
                subtitle: Some(if i == 0 {
                    format!("{} · {line}", t!("team.lead"))
                } else {
                    line
                }),
                sections: vec![
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(space::X5))
                        .children(session)
                        .into_any_element(),
                ],
                actions,
                close_label: t!("common.close").into_owned(),
                on_close: Rc::new(move |_, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.crew_agent = None;
                        cx.notify();
                    });
                }),
            }
            .render(window),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{Activity, activity};
    use crate::state::chat::ChatLog;

    fn event(v: serde_json::Value) -> crate::net::types::SubscribeChatItem {
        serde_json::from_value(v).expect("a chat event")
    }

    fn message(id: &str, agent: &str, at: f64) -> serde_json::Value {
        serde_json::json!({ "id": id, "chatId": "c", "role": "assistant", "text": "done", "agentId": agent,
            "accountId": null, "model": null, "turnId": null, "at": at, "attachments": [], "changes": [],
            "steps": [], "switches": [], "inputTokens": 0, "outputTokens": 0, "cost": null, "durationMs": null,
            "error": null, "revertedAt": null })
    }

    #[test]
    fn an_agent_is_working_replied_or_never_spoke() {
        let mut log = ChatLog::default();
        for (id, agent, at) in [("m1", "a", 1.), ("m2", "b", 2.), ("m3", "a", 3.)] {
            log.apply(event(
                serde_json::json!({ "_tag": "message", "message": message(id, agent, at) }),
            ));
        }
        assert_eq!(activity("a", &log), Activity::Replied { index: 2, at: 3. });
        assert_eq!(activity("z", &log), Activity::Never);
        log.apply(event(serde_json::json!({ "_tag": "turn-started", "turn": {
            "id": "t", "chatId": "c", "state": "running", "model": "anthropic/x", "agentId": "b", "accountId": null,
            "clientId": null, "startedAt": 10, "firstTokenAt": null, "endedAt": null, "error": null,
            "usage": { "inputTokens": 0, "outputTokens": 0, "cachedTokens": 0 } } })));
        assert_eq!(
            activity("b", &log),
            Activity::Working {
                turn_id: "t".into(),
                doing: None,
                since: Some(10.)
            }
        );
    }
}
