// Agent page › Memory: what it remembers, and forgetting it.
use super::*;

impl AgentPage {
    pub(super) fn memory(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let scope = format!("agent:{}", a.id);
        let mine: Vec<_> = self
            .store
            .read(cx)
            .memories
            .iter()
            .filter(|m| m.scope == scope && matches!(m.state, MemoryState::Active))
            .cloned()
            .collect();
        let row = |m: &crate::net::types::Memory| {
            let (store, id) = (self.store.clone(), m.id.clone());
            div()
                .flex()
                .items_start()
                .gap(px(space::X3))
                .py(px(space::X2))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .when(!m.title.is_empty(), |d| {
                            d.child(div().font_weight(FontWeight::MEDIUM).child(m.title.clone()))
                        })
                        .child(div().text_sm().text_color(p.text_secondary).child(m.text.clone())),
                )
                .child(
                    Button::new(
                        SharedString::from(format!("forget-{}", m.id)),
                        t!("knowledge.forget").into_owned(),
                    )
                    .variant(Variant::Ghost)
                    .size(Size::Xs)
                    .on_click(move |_, _, cx| {
                        // Gone at once; the reload brings it back if the engine refuses.
                        store.update(cx, |s, cx| {
                            s.memories.retain(|x| x.id != id);
                            cx.notify();
                        });
                        let (path, body) = (format!("/api/memories/{id}"), json!({ "state": "forgotten" }));
                        store.update(cx, |s, cx| {
                            s.write(crate::state::store::Method::Patch, path, body, cx).detach()
                        });
                    }),
                )
                .into_any_element()
        };
        let facts: Vec<AnyElement> = mine
            .iter()
            .filter(|m| matches!(m.kind, MemoryKind::Fact))
            .map(row)
            .collect();
        let skills: Vec<AnyElement> = mine
            .iter()
            .filter(|m| matches!(m.kind, MemoryKind::Skill))
            .map(row)
            .collect();
        let empty = || {
            div()
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("memory.empty").into_owned())
        };
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(layout::section(
                p,
                t!("agent.mem.notes", name = a.name).into_owned(),
                None,
                None,
                if facts.is_empty() {
                    empty()
                } else {
                    div().flex().flex_col().children(facts)
                },
            ))
            .child(layout::section(
                p,
                t!("agent.skillsTab.title").into_owned(),
                None,
                None,
                if skills.is_empty() {
                    empty()
                } else {
                    div().flex().flex_col().children(skills)
                },
            ))
            .into_any_element()
    }
}
