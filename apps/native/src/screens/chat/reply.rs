// A finished reply: who answers, its text cut where its steps began, and the notes between replies.
use super::*;

impl ChatScreen {
    /// A note in words (the web's TimelineNote).
    pub(super) fn note_text(&self, i: usize, cx: &App) -> String {
        use crate::{net::types::SubscribeChatItemVia as Via, state::chat::Note};
        let store = self.store.read(cx);
        match &self.log.notes[i] {
            Note::Failover { switch, .. } => crate::labels::switch_text(switch, store),
            Note::Worktree { agent_id, branch, .. } => t!(
                "chat.ownCopy",
                agent = store.agent_name(Some(agent_id)),
                branch = branch
            )
            .into_owned(),
            Note::Handoff {
                from, to, via, reason, ..
            } => {
                let to = to
                    .iter()
                    .map(|id| store.agent_name(Some(id)))
                    .collect::<Vec<_>>()
                    .join(", ");
                let from = store.agent_name(from.as_deref());
                match (via, reason) {
                    (Via::Limit, _) => t!("chat.chainStopped").into_owned(),
                    (Via::Reply, _) => t!("chat.handedBack", from = from, to = to).into_owned(),
                    (Via::Route, Some(r)) => t!("chat.routedWhy", to = to, reason = r).into_owned(),
                    (Via::Route, None) => t!("chat.routed", to = to).into_owned(),
                    _ => t!("chat.handoff", from = from, to = to).into_owned(),
                }
            }
        }
    }

    /// The agents a reply may mention, in their colours; a click starts a chat with one.
    pub(super) fn mentions(&self, window: &Window, cx: &mut Context<Self>) -> markdown::Mentions {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let people = store
            .agents
            .iter()
            .filter(|a| a.archived_at.is_none())
            .map(|a| {
                let tone = store.tone(Some(&a.id));
                markdown::Person {
                    handle: crate::state::crew::handle_of(&a.name).to_lowercase(),
                    id: a.id.clone(),
                    name: a.name.clone(),
                    tone,
                    hue: face::hue(p, tone),
                }
            })
            .collect();
        let view = cx.entity().downgrade();
        markdown::Mentions {
            people,
            open: Rc::new(move |id, _, cx| {
                let _ = view.update(cx, |_, cx| cx.emit(ChatEvent::ChatWith(id)));
            }),
        }
    }

    /// A finished reply: who (unless solo or continuing), its text and steps as they happened, how it ended.
    pub(super) fn reply_row(
        &mut self,
        i: usize,
        m: &Message,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let mentions = self.mentions(window, cx);
        let continued = self.continues(i, m);
        let last = i + 1 == self.log.messages.len() && !self.busy();
        let mut column: Vec<AnyElement> = Vec::new();

        // The text cut where steps began; the long thoughts go on top of the first group.
        let work: Vec<Step> = m
            .steps
            .iter()
            .filter(|s| s.tool != "thought" && s.tool != "reply")
            .cloned()
            .collect();
        let thoughts: Vec<Step> = m.steps.iter().filter(|s| s.tool == "thought").cloned().collect();
        let pieces = steps::interleave(&m.text, &work, |s| s.at.map(|a| a.max(0.) as usize));
        let groups = pieces.iter().filter(|p| matches!(p, Piece::Steps(_))).count();
        let mut first = true;
        for (n, piece) in pieces.into_iter().enumerate() {
            match piece {
                Piece::Text(text) => {
                    let key = format!("{}-t{n}", m.id);
                    let blocks = self.parsed.entry(key.clone()).or_insert_with(|| markdown::parse(&text));
                    column.push(markdown::render_with(&key, blocks, Some(&mentions), window).into_any_element());
                }
                Piece::Steps(group) => {
                    let mut all = if first { thoughts.clone() } else { Vec::new() };
                    all.extend(group);
                    first = false;
                    let took = if groups == 1 {
                        m.duration_ms
                    } else {
                        Some(all.iter().filter_map(|s| s.ms).sum())
                    };
                    column.push(self.activity(&format!("{}-g{n}", m.id), &all, took, window, cx));
                }
            }
        }

        column.extend(self.turn_changes(m, window, cx));
        column.extend(self.browser_card(i, m, window, cx));

        // How it ended: a warning line, or the failure with its error.
        if let Some((tone, text)) = steps::ending(m.error.as_deref()) {
            column.push(match tone {
                Tone::Warning => div().text_sm().text_color(p.warning).child(text).into_any_element(),
                Tone::Danger => div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1_5))
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(p.danger)
                            .child(t!("chat.failed").into_owned()),
                    )
                    .child(
                        div()
                            .px(px(space::X3))
                            .py(px(space::X2))
                            .rounded(px(tokens::RADIUS_CONTROL))
                            .bg(p.bg_code)
                            .font_family(MONO)
                            .text_sm()
                            .text_color(p.danger)
                            .child(text),
                    )
                    .into_any_element(),
            });
            if last && m.error.as_deref() != Some("monthly_limit") {
                let id = m.id.clone();
                let label = if m.error.as_deref() == Some("reply_limit") {
                    "chat.continue"
                } else {
                    "chat.retry"
                };
                column.push(
                    div()
                        .child(
                            Button::new(SharedString::from(format!("retry-{}", m.id)), t!(label).into_owned())
                                .icon(IconName::RefreshCw)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, _| this.retry(id.clone()))),
                        )
                        .into_any_element(),
                );
            }
        }

        let store = self.store.read(cx);
        let tone = store.tone(m.agent_id.as_deref());
        let name = store.agent_name(m.agent_id.as_deref());
        let hue = face::hue(p, tone);
        let model = m
            .model
            .as_deref()
            .map(|id| crate::labels::model_name(id, &store.models));
        // The details behind ⓘ: model, tokens, how long, which account and what it cost (a subscription shows the
        // API equivalent, not a charge).
        let account = m
            .account_id
            .as_deref()
            .and_then(|id| store.accounts.iter().find(|a| a.id == id));
        let subscription =
            account.is_some_and(|a| matches!(a.kind, crate::net::types::ProviderAccountKind::Subscription));
        let details: Vec<String> = [
            model.clone(),
            (m.input_tokens > 0. || m.output_tokens > 0.).then(|| {
                t!(
                    "chat.tokens",
                    input = format::compact(m.input_tokens),
                    output = format::compact(m.output_tokens)
                )
                .into_owned()
            }),
            m.duration_ms
                .filter(|ms| *ms >= 1000.)
                .map(|ms| format::duration(ms, format::lang())),
            account.map(|a| a.label.clone()),
            m.cost.map(|c| {
                if subscription {
                    format!("{} {}", t!("usage.apiEquivalent"), format::cost(c))
                } else {
                    format::cost(c)
                }
            }),
        ]
        .into_iter()
        .flatten()
        .collect();
        let group = SharedString::from(format!("reply-{}", m.id));
        let copied = self.copied.as_deref() == Some(&m.id);
        let (id, body) = (m.id.clone(), m.text.clone());
        let actions = div()
            .flex()
            .items_center()
            .gap(px(space::X0_5))
            .ml(px(-space::X1_5))
            .h(px(tokens::CONTROL_H_XS))
            .opacity(0.)
            .group_hover(group.clone(), |s| s.opacity(1.))
            .when(!m.text.is_empty(), |r| {
                r.child(
                    Button::icon_only(
                        SharedString::from(format!("copy-{}", m.id)),
                        if copied { IconName::Check } else { IconName::Copy },
                        if copied { t!("common.copied") } else { t!("common.copy") }.into_owned(),
                    )
                    .size(Size::Xs)
                    .on_click(cx.listener(move |this, _, _, cx| this.copy(id.clone(), body.clone(), cx))),
                )
            })
            .when(!details.is_empty(), |r| {
                r.child(
                    Button::icon_only(
                        SharedString::from(format!("details-{}", m.id)),
                        IconName::Info,
                        t!("chat.details").into_owned(),
                    )
                    .size(Size::Xs)
                    .tooltip(details.join("\n")),
                )
            })
            .child(
                div()
                    .px(px(space::X1_5))
                    .text_xs()
                    .text_color(p.text_dim)
                    .child(format::time(m.at, format::now_ms(), format::lang())),
            )
            .into_any_element();
        column.push(actions);
        // Each failover move of this reply first, as a line of its own.
        let switches: Vec<AnyElement> = m
            .switches
            .iter()
            .map(|sw| separator(crate::labels::switch_text(sw, self.store.read(cx)), window))
            .collect();
        div()
            .group(group)
            .flex()
            .flex_col()
            .gap(px(space::X4))
            .children(switches)
            .child(reply_frame(
                &m.id,
                (!continued).then_some((tone, name, hue, model)),
                FaceState::Idle,
                column,
                p,
            ))
            .into_any_element()
    }

    /// Every reply shows who answers (face and name, as the prototype); it continues the previous one (no face again)
    /// when the same agent answers within 5 minutes.
    pub(super) fn continues(&self, i: usize, m: &Message) -> bool {
        i > 0 && {
            let prev = &self.log.messages[i - 1];
            matches!(prev.role, MessageRole::Assistant)
                && prev.agent_id == m.agent_id
                && m.at - prev.at < CONTINUES_MS
                && m.switches.is_empty()
        }
    }
}

pub(super) fn reply_frame(
    key: &str,
    who: Option<(usize, String, Rgba, Option<String>)>,
    state: FaceState,
    column: Vec<AnyElement>,
    p: &Palette,
) -> AnyElement {
    let face = who.as_ref().map(|(tone, _, _, _)| {
        AgentFace::new(SharedString::from(format!("face-{key}")), *tone)
            .size(28.)
            .state(state)
    });
    div()
        .flex()
        .gap(px(space::X3))
        .child(div().flex_none().w(px(28.)).children(face))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(space::X2))
                .when_some(who, |c, (_, name, hue, model)| {
                    c.child(
                        // As tall as the face, its words centred on it.
                        div()
                            .flex()
                            .items_center()
                            .h(px(28.))
                            .gap(px(space::X2))
                            .child(div().font_weight(FontWeight::SEMIBOLD).text_color(hue).child(name))
                            .when_some(model, |r, m| r.child(div().text_xs().text_color(p.text_dim).child(m))),
                    )
                })
                .children(column),
        )
        .into_any_element()
}

/// A centred line in the timeline (handoffs, failover moves, an agent's own copy): hairlines either side.
pub(super) fn separator(text: String, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    div()
        .flex()
        .items_center()
        .gap(px(space::X3))
        .text_sm()
        .text_color(p.text_muted)
        .child(div().flex_1().h(px(1.)).bg(p.border))
        .child(div().max_w(px(576.)).text_center().child(text))
        .child(div().flex_1().h(px(1.)).bg(p.border))
        .into_any_element()
}
