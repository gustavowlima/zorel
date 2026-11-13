// The chat's crew drawer: opened from the header's faces (screens/members.rs). One card per agent in the chat, in
// order (the lead first), each saying what it is doing now: working (its current step), waiting for you or for
// another agent, when it last replied, or that it hasn't yet. A card opens to its session in this chat, drawn exactly as
// the timeline draws it (the live turn, or its last reply), with Make lead and Remove; below the cards, the agents and
// teams that can join. Built from the shared pieces: ui/drawer, layout::card, NavRow, AgentFace, Button.
use super::*;

use crate::{
    net::types::Agent,
    screens::{chat_actions, members},
    ui::{drawer, layout, nav::NavRow},
};

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
    pub fn open_crew(&mut self, cx: &mut Context<Self>) {
        self.crew_open = true;
        cx.notify();
    }

    pub fn crew_is_open(&self) -> bool {
        self.crew_open
    }

    fn toggle_member(&mut self, agent_id: &str, cx: &mut Context<Self>) {
        if !self.crew_expanded.remove(agent_id) {
            self.crew_expanded.insert(agent_id.to_string());
        }
        cx.notify();
    }

    /// The drawer, while open.
    pub(super) fn crew_drawer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.crew_open {
            return None;
        }
        let p = theme::palette(window);
        let (members, lead_state): (Vec<(Agent, usize)>, FaceState) = {
            let store = self.store.read(cx);
            let chat = store.chat(&self.chat_id)?;
            let members = chat
                .agent_ids
                .iter()
                .filter_map(|id| store.agent(id))
                .map(|a| (a.clone(), store.tone(Some(&a.id))))
                .collect();
            (
                members,
                crate::screens::sidebar::face_state(store.status(&self.chat_id)),
            )
        };
        let ids: Vec<String> = members.iter().map(|(a, _)| a.id.clone()).collect();
        let now = format::now_ms();
        let l = format::lang();
        let mut cards: Vec<AnyElement> = Vec::new();
        for (i, (agent, tone)) in members.iter().enumerate() {
            let doing = activity(&agent.id, &self.log);
            let (state, line, tone_color) = match &doing {
                Activity::Working { doing, since, .. } => {
                    let what = doing.clone().unwrap_or_else(|| t!("activity.working").into_owned());
                    let line = match since.filter(|s| now - s >= 5000.) {
                        Some(s) => format!("{what} · {}", format::duration(now - s, l)),
                        None => what,
                    };
                    (FaceState::Working, line, None)
                }
                Activity::NeedsYou => (
                    FaceState::Waiting,
                    t!("status.waiting", agent = agent.name).into_owned(),
                    Some(p.warning),
                ),
                Activity::WaitsFor(on) => {
                    let store = self.store.read(cx);
                    let others: Vec<String> = on.iter().map(|id| store.agent_name(Some(id))).collect();
                    (
                        FaceState::Waiting,
                        t!("status.waitsFor", agent = agent.name, other = format::list(&others, l)).into_owned(),
                        None,
                    )
                }
                Activity::Replied { at, .. } => (
                    // The lead's face also carries a failed last turn, as the header's.
                    if i == 0 && lead_state == FaceState::Failed {
                        FaceState::Failed
                    } else {
                        FaceState::Idle
                    },
                    t!("team.lastReply", age = format::age(*at, now, l)).into_owned(),
                    None,
                ),
                Activity::Never => (FaceState::Idle, t!("team.noReplies").into_owned(), None),
            };
            let open = self.crew_expanded.contains(&agent.id);
            let id = agent.id.clone();
            let head = NavRow::new(SharedString::from(format!("crew-{}", agent.id)), agent.name.clone())
                .leading(
                    AgentFace::new(SharedString::from(format!("crew-face-{}", agent.id)), *tone)
                        .size(28.)
                        .state(state),
                )
                .detail(line, tone_color)
                .emphasis(true)
                .expanded(open)
                .trailing(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X2))
                        .when(i == 0, |d| d.child(lead_tag(p, *tone)))
                        .child(
                            icon(IconName::ChevronRight, icon::MD)
                                .text_color(p.text_muted)
                                .rotate(radians(if open { std::f32::consts::FRAC_PI_2 } else { 0. })),
                        ),
                )
                .on_click(cx.listener(move |this, _, _, cx| this.toggle_member(&id, cx)));
            let body = open.then(|| self.member_session(i, agent, &doing, &ids, window, cx));
            cards.push(
                layout::card(p)
                    .flex()
                    .flex_col()
                    .child(head)
                    .children(body)
                    .into_any_element(),
            );
        }
        if cards.is_empty() {
            cards.push(
                div()
                    .text_sm()
                    .text_color(p.text_dim)
                    .child(format!("{} {}", t!("team.noAgents"), t!("team.noAgentsHint")))
                    .into_any_element(),
            );
        }
        if members.len() > 1 {
            cards.push(
                div()
                    .text_sm()
                    .text_color(p.text_dim)
                    .child(t!("team.mentionHint").into_owned())
                    .into_any_element(),
            );
        }
        let mut sections = vec![
            div()
                .flex()
                .flex_col()
                .gap(px(space::X2))
                .children(cards)
                .into_any_element(),
        ];
        let agents = members::agents_to_add(&self.store, &self.chat_id, window, cx);
        if !agents.is_empty() {
            sections.push(drawer::section(t!("team.add").into_owned(), None, agents, window));
        }
        let teams = members::teams_to_add(&self.store, &self.chat_id, window, cx);
        if !teams.is_empty() {
            sections.push(drawer::section(t!("teams.addTeam").into_owned(), None, teams, window));
        }
        let view = cx.entity().downgrade();
        Some(
            drawer::Drawer {
                id: SharedString::from(format!("crew-{}", self.chat_id)),
                mark: None,
                title: t!("team.title").into_owned(),
                subtitle: Some(tn("teams.count", members.len() as i64)),
                sections,
                actions: Vec::new(),
                close_label: t!("common.close").into_owned(),
                on_close: Rc::new(move |_, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.crew_open = false;
                        cx.notify();
                    });
                }),
            }
            .render(window),
        )
    }

    /// An open card: the agent's session in this chat, as the timeline draws it, then what can be done with it.
    fn member_session(
        &mut self,
        i: usize,
        agent: &Agent,
        doing: &Activity,
        ids: &[String],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let session = match doing {
            Activity::Working { turn_id, .. } => self.live_row(turn_id, window, cx),
            Activity::Replied { index, .. } => {
                let m = self.log.messages[*index].clone();
                self.reply_row(*index, &m, window, cx)
            }
            _ => div()
                .text_sm()
                .text_color(p.text_dim)
                .child(t!("team.sessionEmpty").into_owned())
                .into_any_element(),
        };
        let lead = (i > 0).then(|| {
            let order: Vec<String> = std::iter::once(agent.id.clone())
                .chain(ids.iter().filter(|x| **x != agent.id).cloned())
                .collect();
            let (store, chat_id, model) = (self.store.clone(), self.chat_id.clone(), agent.model.clone());
            Button::new(
                SharedString::from(format!("crew-lead-{}", agent.id)),
                t!("team.makeLead").into_owned(),
            )
            .variant(Variant::Ghost)
            .size(Size::Sm)
            .on_click(move |_, _, cx| {
                // The lead's model drives the chat, so it follows the new lead.
                chat_actions::set_team(&store, &chat_id, order.clone(), Some(model.clone()), cx)
            })
        });
        // A chat always keeps one agent: the last one can't be removed, only swapped for another.
        let remove = (ids.len() > 1).then(|| {
            let rest: Vec<String> = ids.iter().filter(|x| **x != agent.id).cloned().collect();
            let (store, chat_id) = (self.store.clone(), self.chat_id.clone());
            Button::new(
                SharedString::from(format!("crew-remove-{}", agent.id)),
                t!("common.remove").into_owned(),
            )
            .icon(IconName::X)
            .name(t!("team.removeMember", name = agent.name).into_owned())
            .variant(Variant::Ghost)
            .size(Size::Sm)
            .on_click(move |_, _, cx| chat_actions::set_team(&store, &chat_id, rest.clone(), None, cx))
        });
        div()
            .flex()
            .flex_col()
            .gap(px(space::X3))
            .mt(px(space::X1))
            .px(px(space::X2_5))
            .pt(px(space::X3))
            .pb(px(space::X1))
            .border_t_1()
            .border_color(p.border)
            .child(
                div()
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(p.text_muted)
                    .child(t!("team.session").into_owned()),
            )
            .child(session)
            .when(lead.is_some() || remove.is_some(), |c| {
                c.child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(space::X1))
                        .children(lead)
                        .children(remove),
                )
            })
            .into_any_element()
    }
}

/// The lead's badge: "Lead" on a soft pill of its colour.
fn lead_tag(p: &Palette, tone: usize) -> impl IntoElement {
    let hue = face::hue(p, tone);
    div()
        .flex_none()
        .flex()
        .items_center()
        .h(px(20.))
        .px(px(space::X2))
        .rounded_full()
        .border_1()
        .border_color(face::mix(hue, 0.35, p.bg_surface))
        .bg(face::mix(hue, 0.12, p.bg_surface))
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(p.text)
        .child(t!("team.lead").into_owned())
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
