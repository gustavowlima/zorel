// The reply being written: its steps as they happen, the text revealed smoothly, and what it does now.
use super::*;

impl ChatScreen {
    /// A turn in progress, laid out as it happens (the web's LiveMessage): what it has written so far, cut where steps
    /// began, each run of steps a group (its summary, open while it works) on the tree; at the end what it does now
    /// (a light sweeps across it; plainly while it waits), the time only after 5 s, and Stop beside it.
    pub(super) fn live_row(&mut self, turn_id: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let turn = self.log.turns.iter().find(|t| t.id == turn_id).cloned();
        let agent = turn.as_ref().and_then(|t| t.agent_id.clone());
        let text: String = self
            .log
            .partial
            .get(turn_id)
            .map(|t| t.chars().take(*self.shown.get(turn_id).unwrap_or(&0)).collect())
            .unwrap_or_default();
        // With the Builder's proposal out, its waiting step is the card itself: not repeated as a step or a status.
        let proposal_out = self.proposal().is_some();
        let live_steps: Vec<WorkStep> = self
            .log
            .steps
            .iter()
            .filter(|s| s.turn_id == turn_id)
            .filter(|s| !(proposal_out && matches!(s.status, WorkStepStatus::Waiting)))
            .cloned()
            .collect();
        let thought = self.log.thought.get(turn_id).cloned().unwrap_or_default();
        let mentions = self.mentions(window, cx);
        let mut column: Vec<AnyElement> = Vec::new();
        // Its thinking, once over: how long (a finished reply keeps it in its steps).
        if !thought.now && thought.took >= 1000. {
            column.push(
                step_line(
                    &format!("{turn_id}-thought"),
                    IconName::Brain,
                    p.text_muted,
                    t!(
                        "activity.thought",
                        time = format::duration(thought.took, format::lang())
                    )
                    .into_owned(),
                    None,
                    p,
                )
                .into_any_element(),
            );
        }
        let at = self.log.step_at.clone();
        let pieces = steps::interleave(&text, &live_steps, |s| at.get(&s.id).copied());
        for (n, piece) in pieces.into_iter().enumerate() {
            match piece {
                Piece::Text(text) => {
                    let blocks = markdown::parse(&text);
                    column.push(
                        markdown::render_with(&format!("{turn_id}-t{n}"), &blocks, Some(&mentions), window)
                            .into_any_element(),
                    );
                }
                Piece::Steps(group) => column.push(self.live_group(&format!("{turn_id}-g{n}"), &group, window, cx)),
            }
        }
        // What you decided in this turn: a line each, opening to what it ran.
        let receipts: Vec<crate::state::chat::Receipt> = self
            .log
            .receipts
            .iter()
            .filter(|r| r.approval.turn_id.as_deref() == Some(turn_id))
            .cloned()
            .collect();
        for r in &receipts {
            column.push(self.receipt(r, window, cx));
        }
        // While it thinks: the last of its words, quiet, two lines at most (engines that show them).
        if thought.now && !proposal_out {
            let words = last_words(&thought.text, 240);
            if !words.is_empty() {
                column.push(
                    div()
                        .text_sm()
                        .text_color(p.text_dim)
                        .line_clamp(2)
                        .child(words)
                        .into_any_element(),
                );
            }
        }
        let store = self.store.read(cx);
        let name = store.agent_name(agent.as_deref());
        let tone = store.tone(agent.as_deref());
        // What it does now. Waiting for you (an approval, a question): say so, not the step's title again.
        let current = live_steps
            .iter()
            .rev()
            .find(|s| matches!(s.status, WorkStepStatus::Running | WorkStepStatus::Waiting));
        let asks = self.log.approvals.iter().any(|a| a.turn_id.as_deref() == Some(turn_id));
        let waiting = asks || current.is_some_and(|s| matches!(s.status, WorkStepStatus::Waiting));
        let idle = text.is_empty() && live_steps.is_empty();
        let label = match current {
            _ if waiting => {
                let question = current
                    .and_then(|s| s.tool.as_deref())
                    .is_some_and(|t| t.ends_with("zorel_ask_user"));
                t!(
                    if question { "status.asking" } else { "approval.waitsFor" },
                    agent = name
                )
                .into_owned()
            }
            Some(step) => step.title.clone(),
            None if thought.now => t!("activity.thinking").into_owned(),
            None if idle => {
                let model = turn.as_ref().map(|t| t.model.clone()).unwrap_or_default();
                let (provider, _) = crate::labels::split_model(&model);
                t!(
                    "activity.waitingFor",
                    provider = crate::labels::provider_label(provider)
                )
                .into_owned()
            }
            None => t!("activity.working").into_owned(),
        };
        let started = turn.as_ref().and_then(|t| t.started_at);
        let elapsed = started
            .map(|at| format::now_ms() - at)
            .filter(|ms| *ms >= 5000. && !waiting)
            .map(|ms| format::duration(ms, format::lang()));
        if !proposal_out {
            let mark: AnyElement = if waiting {
                icon(IconName::Clock, icon::SM).text_color(p.warning).into_any_element()
            } else {
                Loader::new(SharedString::from(format!("live-mark-{turn_id}")))
                    .size(icon::SM)
                    .color(p.text_muted)
                    .into_any_element()
            };
            // Plain while it waits (on you, or on the provider before anything came back); a light sweeps otherwise.
            let words: AnyElement = if waiting || idle {
                div()
                    .truncate()
                    .text_color(if waiting { p.warning } else { p.text_muted })
                    .child(label)
                    .into_any_element()
            } else {
                shimmer(
                    SharedString::from(format!("live-shimmer-{turn_id}")),
                    label,
                    p.text_muted,
                    p.text,
                )
                .into_any_element()
            };
            column.push(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .h(px(tokens::CONTROL_H_SM))
                    .text_sm()
                    .child(div().flex_none().w(px(icon::MD)).flex().justify_center().child(mark))
                    .child(div().min_w_0().child(words))
                    .when_some(elapsed, |r, e| {
                        r.child(div().flex_none().text_color(p.text_dim).child(format!("· {e}")))
                    })
                    .child(
                        Button::stop(
                            SharedString::from(format!("live-stop-{turn_id}")),
                            t!("composer.stop").into_owned(),
                        )
                        // A soft round button, so the square reads as Stop, not a stray mark.
                        .variant(Variant::Secondary)
                        .size(Size::Xs)
                        .on_click(cx.listener(|this, _, _, cx| this.stop(cx))),
                    )
                    .into_any_element(),
            );
        }
        reply_frame(
            turn_id,
            Some((tone, name, face::hue(p, tone), None)),
            // A question or a proposal waits on you: the face says so, not "working".
            if waiting || proposal_out {
                FaceState::Waiting
            } else {
                FaceState::Working
            },
            column,
            p,
        )
    }
}

/// A reply's frame: the face (and name, in the agent's hue; the model on hover) on the left, then its column.
/// The tail of a growing text, at most `max` chars, starting at a word, on one line.
fn last_words(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let n = flat.chars().count();
    if n <= max {
        return flat;
    }
    let tail: String = flat.chars().skip(n - max).collect();
    match tail.split_once(' ') {
        Some((_, rest)) => format!("…{rest}"),
        None => tail,
    }
}
