// What an approval decided, shown in the timeline where it happened.
use super::*;

impl ChatScreen {
    /// A decided approval or question (the web's ReceiptCard): its outcome and what it was (or what you said), a
    /// line that opens to the command it ran (with Copy), the folder and any other arguments.
    pub(super) fn receipt(
        &mut self,
        r: &crate::state::chat::Receipt,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use crate::net::types::SubscribeChatItemOutcome as O;
        let p = theme::palette(window);
        let a = &r.approval;
        let question = matches!(a.kind, crate::net::types::ApprovalKind::Question);
        let ok = matches!(r.outcome, O::Approved | O::Always);
        let word = match (r.outcome, question, ok) {
            (O::Expired, _, _) => t!("approval.expired"),
            (_, true, true) => t!("question.answered"),
            (_, true, false) => t!("question.skipped"),
            (_, false, true) => t!("approval.approved"),
            (_, false, false) => t!("approval.denied"),
        }
        .into_owned();
        let (mark, mark_color) = match (r.outcome, ok) {
            (O::Expired, _) => (IconName::Clock, p.text_muted),
            (_, true) => (IconName::CircleCheck, p.success),
            (_, false) => (IconName::CircleX, p.text_muted),
        };
        let summary = if a.summary.is_empty() {
            a.tool.clone()
        } else {
            a.summary.clone()
        };
        let command = if question {
            String::new()
        } else {
            steps::command_of(&a.tool, &a.args)
        };
        let extra = (!question)
            .then(|| steps::extra_args(&a.tool, &a.args, &command))
            .flatten();
        let key = format!("receipt-{}", a.id);
        let open = self.open.contains(&key);
        let toggle_key = key.clone();
        let head = div()
            .id(SharedString::from(key.clone()))
            .role(Role::Button)
            .aria_expanded(open)
            .flex()
            .items_center()
            .gap(px(space::X2))
            .h(px(28.))
            .px(px(space::X2))
            .rounded(px(tokens::RADIUS_CONTROL_SM))
            .text_sm()
            .text_color(p.text_muted)
            .hover(|s| s.bg(p.bg_control))
            .child(icon(mark, icon::XS).text_color(mark_color))
            .child(div().flex_none().text_color(p.text_secondary).child(word))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .child(r.reason.as_ref().map_or(summary.clone(), |why| format!("“{why}”"))),
            )
            .child(icon(
                if open {
                    IconName::ChevronUp
                } else {
                    IconName::ChevronDown
                },
                icon::XS,
            ))
            .on_click(cx.listener(move |this, _, _, cx| this.toggle(toggle_key.clone(), cx)));
        let body = open.then(|| {
            let copied = self.copied.as_deref() == Some(key.as_str());
            let to_copy = if command == a.tool {
                extra.clone().unwrap_or_default()
            } else {
                command.clone()
            };
            let copy_key = key.clone();
            div()
                .flex()
                .flex_col()
                .gap(px(space::X2))
                .px(px(space::X3))
                .py(px(space::X2_5))
                .rounded(px(tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .bg(p.bg_code)
                .text_sm()
                .when(question || !summary.contains(&command), |c| {
                    c.child(div().text_color(p.text_secondary).child(summary.clone()))
                })
                .when(!command.is_empty(), |c| {
                    c.child(
                        div()
                            .flex()
                            .items_start()
                            .gap(px(space::X2))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .font_family(MONO)
                                    .text_color(p.text_secondary)
                                    .child(command.clone()),
                            )
                            .child(
                                Button::icon_only(
                                    SharedString::from(format!("{key}-copy")),
                                    if copied { IconName::Check } else { IconName::Copy },
                                    if copied { t!("common.copied") } else { t!("common.copy") }.into_owned(),
                                )
                                .size(Size::Xs)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.copy(copy_key.clone(), to_copy.clone(), cx)),
                                ),
                            ),
                    )
                })
                .when_some(a.cwd.clone(), |c, cwd| {
                    c.child(
                        div()
                            .text_color(p.text_muted)
                            .child(t!("approval.folder", path = cwd).into_owned()),
                    )
                })
                .when_some(extra.clone(), |c, extra| {
                    c.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X1))
                            .child(
                                div()
                                    .text_color(p.text_muted)
                                    .child(t!("approval.details").into_owned()),
                            )
                            .child(div().font_family(MONO).text_color(p.text_muted).child(extra)),
                    )
                })
        });
        div()
            .flex()
            .flex_col()
            .gap(px(space::X1))
            .max_w(px(520.))
            .child(head)
            .children(body)
            .into_any_element()
    }
}
