// Agent page › Tools: the connectors and tools it may use, and how.
use super::*;

impl AgentPage {
    pub(super) fn tools(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let power = |glyph: IconName, title: String, hint: String, control: AnyElement, warn: bool| {
            div()
                .flex()
                .items_center()
                .gap(px(space::X3))
                .py(px(space::X3))
                .child(icon(glyph, icon::MD).text_color(if warn { p.warning } else { p.text_muted }))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().font_weight(FontWeight::MEDIUM).child(title))
                        .child(
                            div()
                                .text_sm()
                                .text_color(if warn { p.warning } else { p.text_muted })
                                .child(hint),
                        ),
                )
                .child(control)
                .into_any_element()
        };
        let level = |key: &str| SharedString::from(t!(format!("agent.perm.level.{key}")).into_owned());
        let at = ACCESS.iter().position(|(x, _)| *x == self.access).unwrap_or(1);
        let files = Segmented::new(
            "perm-files",
            t!("agent.perm.files").into_owned(),
            ACCESS.iter().map(|(_, k)| level(k)).collect(),
            at,
            Rc::new({
                let view = cx.entity().downgrade();
                move |i, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.access = ACCESS[i].0;
                        cx.notify();
                    });
                }
            }),
        );
        let flag = |key: &'static str, on_label: &str| {
            let on = self.permissions[key].as_bool().unwrap_or(true);
            let view = cx.entity().downgrade();
            Segmented::new(
                SharedString::from(format!("perm-{key}")),
                key,
                vec![level("none"), level(on_label)],
                usize::from(on),
                Rc::new(move |i, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.permissions[key] = Value::Bool(i == 1);
                        cx.notify();
                    });
                }),
            )
            .into_any_element()
        };
        let access_rows = vec![
            power(
                IconName::SquareTerminal,
                t!("agent.perm.files").into_owned(),
                t!(format!("agent.perm.filesHint.{}", ACCESS[at].1)).into_owned(),
                files.into_any_element(),
                self.access == AgentAccess::Full,
            ),
            power(
                IconName::Globe,
                t!("agent.perm.web").into_owned(),
                t!("agent.perm.webHint").into_owned(),
                flag("web", "read"),
                false,
            ),
            power(
                IconName::Globe,
                t!("agent.perm.browser").into_owned(),
                t!("agent.perm.browserHint").into_owned(),
                flag("browser", "use"),
                false,
            ),
        ];
        // The connectors in its reach: global ones and its project's.
        let servers: Vec<McpServer> = self
            .servers
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.project_id.is_none() || s.project_id == a.project_id)
            .collect();
        let connectors: Vec<AnyElement> = servers
            .iter()
            .map(|s| {
                let read_only = matches!(s.mode, crate::net::types::McpServerMode::Read);
                let levels: Vec<&str> = if read_only {
                    vec!["none", "read"]
                } else {
                    vec!["none", "read", "write"]
                };
                let given = self.permissions["grants"][&s.id].as_str().unwrap_or("read").to_string();
                let given = if read_only && given == "write" {
                    "read".to_string()
                } else {
                    given
                };
                let at = levels.iter().position(|l| *l == given).unwrap_or(1);
                let (view, id, opts) = (
                    cx.entity().downgrade(),
                    s.id.clone(),
                    levels.iter().map(|l| l.to_string()).collect::<Vec<_>>(),
                );
                power(
                    IconName::Plug,
                    s.name.clone(),
                    if s.enabled {
                        t!("agent.perm.connectorHint")
                    } else {
                        t!("agent.perm.off")
                    }
                    .into_owned(),
                    Segmented::new(
                        SharedString::from(format!("perm-mcp-{}", s.id)),
                        s.name.clone(),
                        levels.iter().map(|l| level(l)).collect(),
                        at,
                        Rc::new(move |i, _, cx| {
                            let (id, value) = (id.clone(), opts[i].clone());
                            let _ = view.update(cx, |this, cx| {
                                if !this.permissions["grants"].is_object() {
                                    this.permissions["grants"] = json!({});
                                }
                                this.permissions["grants"][id] = Value::String(value);
                                cx.notify();
                            });
                        }),
                    )
                    .into_any_element(),
                    false,
                )
            })
            .collect();
        // What was allowed for good from an approval card, each removable.
        let always: Vec<String> = self.permissions["always"]
            .as_array()
            .map(|v| v.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let always_rows: Vec<AnyElement> = always
            .iter()
            .map(|key| {
                let label = if key == "browser" {
                    t!("agent.perm.alwaysBrowser").into_owned()
                } else {
                    match key.split_once(':') {
                        Some((sid, tool)) => {
                            let name = servers
                                .iter()
                                .find(|s| s.id == sid)
                                .map_or(sid.to_string(), |s| s.name.clone());
                            format!("{name} · {tool}")
                        }
                        None => key.clone(),
                    }
                };
                let (view, k) = (cx.entity().downgrade(), key.clone());
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .py(px(space::X1))
                    .child(div().flex_1().min_w_0().truncate().text_sm().child(label.clone()))
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("always-{key}")),
                            IconName::X,
                            t!("agent.perm.removeAlways", name = label).into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(move |_, _, cx| {
                            let k = k.clone();
                            let _ = view.update(cx, |this, cx| {
                                if let Some(list) = this.permissions["always"].as_array_mut() {
                                    list.retain(|x| x.as_str() != Some(k.as_str()));
                                }
                                cx.notify();
                            });
                        }),
                    )
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(layout::section(
                p,
                t!("agent.perm.accessTitle").into_owned(),
                None,
                None,
                div().flex().flex_col().children(access_rows),
            ))
            .child(layout::section(
                p,
                t!("agent.perm.connectorsTitle").into_owned(),
                Some(t!("agent.perm.toolsHint").into_owned()),
                None,
                if connectors.is_empty() {
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("agent.perm.noConnectors").into_owned())
                } else {
                    div().flex().flex_col().children(connectors)
                },
            ))
            .when(!always_rows.is_empty(), |d| {
                d.child(layout::section(
                    p,
                    t!("agent.perm.always").into_owned(),
                    None,
                    None,
                    div().flex().flex_col().children(always_rows),
                ))
            })
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_dim)
                    .child(t!("agent.perm.guard").into_owned()),
            )
            .into_any_element()
    }
}
