// Agent page › Work: what the agent is doing and its sessions.
use super::*;

impl AgentPage {
    pub(super) fn work(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let now = store
            .chats
            .statuses
            .values()
            .find(|s| s.agent_id.as_deref() == Some(&a.id) && !matches!(s.state, ChatStatusState::Idle))
            .cloned();
        let mut sessions: Vec<_> = store
            .chats
            .chats
            .iter()
            .filter(|c| c.agent_ids.contains(&a.id))
            .cloned()
            .collect();
        sessions.sort_by(|x, y| y.last_at.unwrap_or(0.).total_cmp(&x.last_at.unwrap_or(0.)));
        let (when_now, l) = (format::now_ms(), format::lang());
        let now_row: AnyElement = match now {
            Some(s) => {
                let (chat, word, color) = match s.state {
                    ChatStatusState::Running => (s.chat_id.clone(), t!("agent.work.running"), p.text),
                    ChatStatusState::Waiting => (s.chat_id.clone(), t!("agent.work.waiting"), p.warning),
                    _ => (s.chat_id.clone(), t!("agent.work.failed"), p.danger),
                };
                let title = store.chat(&chat).map(crate::labels::chat_title).unwrap_or_default();
                NavRow::new("agent-now", title)
                    .detail(format!("{word} · {}", s.label), Some(color))
                    .emphasis(true)
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(AgentPageEvent::Navigate(Route::Chat { id: chat.clone() }))
                    }))
                    .into_any_element()
            }
            None => div()
                .px(px(space::X3))
                .py(px(space::X2))
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("agent.work.idle").into_owned())
                .into_any_element(),
        };
        let rows: Vec<AnyElement> = sessions
            .iter()
            .take(50)
            .map(|c| {
                let id = c.id.clone();
                NavRow::new(
                    SharedString::from(format!("agent-session-{}", c.id)),
                    crate::labels::chat_title(c),
                )
                .detail(
                    c.last_at.map(|at| format::age(at, when_now, l)).unwrap_or_default(),
                    None,
                )
                .on_click(
                    cx.listener(move |_, _, _, cx| cx.emit(AgentPageEvent::Navigate(Route::Chat { id: id.clone() }))),
                )
                .into_any_element()
            })
            .collect();
        let talk = a.id.clone();
        div()
            .flex()
            .flex_col()
            .gap(px(space::X7))
            .child(
                div().child(
                    Button::new("agent-talk", t!("agent.work.talk", name = a.name).into_owned())
                        .icon(IconName::MessageCircle)
                        .variant(Variant::Primary)
                        .size(Size::Sm)
                        .on_click(cx.listener(move |_, _, _, cx| cx.emit(AgentPageEvent::ChatWith(talk.clone())))),
                ),
            )
            .child(layout::section(
                p,
                t!("agent.work.now").into_owned(),
                Some(t!("agent.work.nowHint").into_owned()),
                None,
                layout::rows(p).child(now_row),
            ))
            .child(layout::section(
                p,
                t!("agent.work.sessions").into_owned(),
                Some(t!("agent.work.sessionsHint").into_owned()),
                None,
                if rows.is_empty() {
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("agent.work.noSessions").into_owned())
                } else {
                    layout::rows(p).children(rows)
                },
            ))
            .into_any_element()
    }
}
