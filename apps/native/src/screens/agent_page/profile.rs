// Agent page › Profile: name, title, description, instructions, model, access and limits.
use super::*;

impl AgentPage {
    pub(super) fn field(label: String, hint: Option<String>, control: AnyElement, p: &tokens::Palette) -> Div {
        div()
            .flex()
            .flex_col()
            .gap(px(space::X1_5))
            .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(label))
            .child(control)
            .when_some(hint, |d, h| d.child(div().text_xs().text_color(p.text_muted).child(h)))
    }

    pub(super) fn boxed(content: impl IntoElement, p: &tokens::Palette) -> Div {
        div()
            .px(px(space::X2_5))
            .py(px(space::X1_5))
            .min_h(px(tokens::CONTROL_H))
            .flex()
            .items_center()
            .rounded(px(tokens::RADIUS_CONTROL))
            .border_1()
            .border_color(p.border)
            .bg(p.bg_field)
            .child(div().flex_1().child(content))
    }

    pub(super) fn limit_select(&self, a: &Agent, field: &'static str, steps: &[f64], current: Option<f64>) -> Select {
        let mut values: Vec<Option<f64>> = std::iter::once(None).chain(steps.iter().copied().map(Some)).collect();
        if let Some(c) = current.filter(|c| !steps.contains(c)) {
            values.push(Some(c));
        }
        let options = values
            .iter()
            .map(|v| SelectOption {
                id: v.map(|n| (n as i64).to_string()).unwrap_or_default(),
                label: match v {
                    None => t!("agent.noLimit").into_owned().into(),
                    Some(n) => t!("agent.tokens", n = format::compact(*n)).into_owned().into(),
                },
                mark: select::Mark::None,
            })
            .collect();
        let (store, id) = (self.store.clone(), a.id.clone());
        let pick: select::OnPick = Rc::new(move |v, _, cx| {
            let value: Value = v.parse::<i64>().map(Value::from).unwrap_or(Value::Null);
            let (path, body) = (format!("/api/agents/{id}"), json!({ field: value }));
            store.update(cx, |s, cx| {
                s.write(crate::state::store::Method::Patch, path, body, cx).detach()
            });
        });
        Select::new(
            SharedString::from(format!("agent-{field}")),
            field,
            options,
            current.map(|n| (n as i64).to_string()).unwrap_or_default(),
            pick,
        )
        .filled()
    }

    pub(super) fn profile(&mut self, a: &Agent, window: &mut Window, _: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let who = div()
            .flex()
            .flex_col()
            .gap(px(space::X4))
            .child(
                div()
                    .grid()
                    .grid_cols(2)
                    .gap(px(space::X4))
                    .child(Self::field(
                        t!("agent.name").into_owned(),
                        None,
                        Self::boxed(Input::new(&self.name).appearance(false), p).into_any_element(),
                        p,
                    ))
                    .child(Self::field(
                        t!("agent.titleField").into_owned(),
                        Some(t!("agent.titleHint").into_owned()),
                        Self::boxed(Input::new(&self.title).appearance(false), p).into_any_element(),
                        p,
                    )),
            )
            .child(Self::field(
                t!("agent.description").into_owned(),
                Some(t!("agent.descriptionHint").into_owned()),
                Self::boxed(Textarea::new(&self.description), p).into_any_element(),
                p,
            ));
        let row = |title: String, hint: String, control: AnyElement| {
            div()
                .flex()
                .items_center()
                .gap(px(space::X4))
                .py(px(space::X3))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().font_weight(FontWeight::MEDIUM).child(title))
                        .child(div().text_sm().text_color(p.text_muted).child(hint)),
                )
                .child(control)
        };
        let brain = div()
            .flex()
            .flex_col()
            .child(row(
                t!("agent.model").into_owned(),
                t!("agent.modelHint").into_owned(),
                self.model.clone().into_any_element(),
            ))
            .child(row(
                t!("agent.monthlyLimit").into_owned(),
                t!("agent.monthlyLimitHint").into_owned(),
                self.limit_select(a, "monthlyTokens", &MONTHLY, a.monthly_tokens)
                    .into_any_element(),
            ))
            .child(row(
                t!("agent.replyLimit").into_owned(),
                t!("agent.replyLimitHint").into_owned(),
                self.limit_select(a, "replyTokens", &PER_REPLY, a.reply_tokens)
                    .into_any_element(),
            ));
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(layout::section(p, t!("agent.who").into_owned(), None, None, who))
            .child(layout::section(p, t!("agent.brain").into_owned(), None, None, brain))
            .child(layout::section(
                p,
                t!("agent.instructions").into_owned(),
                Some(t!("agent.roleHint").into_owned()),
                None,
                Self::boxed(Textarea::new(&self.instructions), p).items_start(),
            ))
            .into_any_element()
    }
}
