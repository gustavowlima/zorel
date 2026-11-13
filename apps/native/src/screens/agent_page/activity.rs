// Agent page › Activity: its versions, and restoring one.
use super::*;

impl AgentPage {
    pub(super) fn activity(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let Some(versions) = self.versions.clone() else {
            return div()
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("common.checking").into_owned())
                .into_any_element();
        };
        let (now, l) = (format::now_ms(), format::lang());
        let rows: Vec<AnyElement> = versions
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let who = if v.by == "you" {
                    t!("agent.byYou").into_owned()
                } else {
                    self.store.read(cx).agent_name(Some(&v.by))
                };
                let n = v.n as i64;
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .py(px(space::X2))
                    .child(
                        div()
                            .flex_none()
                            .w(px(32.))
                            .font_family(crate::ui::code::MONO)
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(format!("v{n}")),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_sm()
                            .child(format!("{who} · {}", format::age(v.at, now, l))),
                    )
                    .child(if i == 0 {
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("agent.current").into_owned())
                            .into_any_element()
                    } else {
                        Button::new(
                            SharedString::from(format!("restore-{n}")),
                            t!("agent.restore").into_owned(),
                        )
                        .variant(Variant::Ghost)
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, window, cx| this.ask_restore(n, window, cx)))
                        .into_any_element()
                    })
                    .into_any_element()
            })
            .collect();
        layout::section(
            p,
            t!("agent.history").into_owned(),
            Some(t!("agent.historyHint").into_owned()),
            None,
            div().flex().flex_col().children(rows),
        )
        .into_any_element()
    }

    pub(super) fn ask_restore(&mut self, n: i64, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, _| {
            let view = view.clone();
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("agent.restoreTitle", n = n).into_owned(),
                    description: Some(t!("agent.restoreBody").into_owned()),
                    body: None,
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("restore", t!("agent.restore").into_owned())
                            .variant(Variant::Primary)
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                let _ = view.update(cx, |this, cx| {
                                    let path = format!("/api/agents/{}/versions/{n}/restore", this.id);
                                    let restored = this.store.update(cx, |s, cx| {
                                        s.write(crate::state::store::Method::Post, path, json!({}), cx)
                                    });
                                    cx.spawn_in(window, async move |this, cx| {
                                        restored.await;
                                        let _ = this.update_in(cx, |this, window, cx| {
                                            this.versions = None;
                                            this.load(cx);
                                            this.discard(window, cx);
                                        });
                                    })
                                    .detach();
                                });
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }
}
