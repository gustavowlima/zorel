// Settings › MCP servers (apps/web/src/features/mcp.tsx, the prototype's "MCP servers"): the servers you added yourself
// (not from the Connectors catalog), each with its kind and command or URL, its mode, a test that connects and lists
// its tools, Sign in for OAuth ones, on/off and Remove; Add a custom connector opens a dialog (local or remote, name, the
// command or URL, secrets as NAME=value kept in the system keychain); under it, what each mode means.
use super::*;

use crate::{
    net::types::{McpServer, McpServerMode},
    ui::button::{Button, Size, Variant},
};
use gpui_kit::{
    base::input::{Textarea, TextareaState},
    component::WindowExt as _,
    component::input::{Input, InputState},
};

#[derive(Default)]
pub struct Connectors {
    pub(super) list: Option<Vec<McpServer>>,
    pub(super) tested: std::collections::HashMap<String, String>,
    pub(super) error: Option<String>,
    /// The catalog's state (screens/settings/connectors.rs): OAuth servers holding a token, ones refused, the
    /// sign-in open in the browser, the row being managed, the connector asking for a token.
    pub(super) signed_in: Vec<String>,
    pub(super) refused: Vec<String>,
    pub(super) waiting: Option<String>,
    pub(super) token_for: Option<&'static str>,
    pub(super) asked_signed_in: bool,
}

pub(super) const MODES: [(McpServerMode, &str); 3] = [
    (McpServerMode::Read, "read"),
    (McpServerMode::Approve, "approve"),
    (McpServerMode::Auto, "auto"),
];

impl Settings {
    pub(super) fn load_connectors(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(l)) = runtime::spawn(async move { http.get::<Vec<McpServer>>("/api/mcp").await }).await {
                let _ = this.update(cx, |this, cx| {
                    this.connectors.list = Some(l);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    pub(super) fn patch_connector(&mut self, id: String, body: Value, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let path = format!("/api/mcp/{id}");
            let _ = runtime::spawn(async move { http.patch::<_, Value>(&path, &body).await }).await;
            let _ = this.update(cx, |this, cx| this.load_connectors(cx));
        })
        .detach();
    }

    pub(super) fn remove_connector(&mut self, id: String, cx: &mut Context<Self>) {
        if let Some(l) = &mut self.connectors.list {
            l.retain(|s| s.id != id);
        }
        cx.notify();
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let path = format!("/api/mcp/{id}");
            let _ = runtime::spawn(async move { http.delete(&path).await }).await;
            let _ = this.update(cx, |this, cx| this.load_connectors(cx));
        })
        .detach();
    }

    pub(super) fn test_connector(&mut self, id: String, cx: &mut Context<Self>) {
        self.connectors
            .tested
            .insert(id.clone(), t!("common.checking").into_owned());
        cx.notify();
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let path = format!("/api/mcp/{id}/tools");
            let got = runtime::spawn(async move { http.get::<Value>(&path).await }).await;
            let line = match got {
                Ok(Ok(v)) => match v["error"].as_str() {
                    Some(e) => t!("mcp.failed", error = e).into_owned(),
                    None => {
                        let names: Vec<String> = v["tools"]
                            .as_array()
                            .map(|t| {
                                t.iter()
                                    .filter_map(|x| x["name"].as_str().map(str::to_string))
                                    .collect()
                            })
                            .unwrap_or_default();
                        format!("{} · {}", names.len(), names.join(", "))
                    }
                },
                _ => t!("mcp.failed", error = "?").into_owned(),
            };
            let _ = this.update(cx, |this, cx| {
                this.connectors.tested.insert(id, line);
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn sign_in_connector(&mut self, id: String, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |_, cx| {
            let path = format!("/api/mcp/{id}/sign-in");
            if let Ok(Ok(v)) = runtime::spawn(async move { http.post::<_, Value>(&path, &json!({})).await }).await
                && let Some(url) = v["authorizeUrl"].as_str()
            {
                let url = url.to_string();
                cx.update(|cx| cx.open_url(&url));
            }
        })
        .detach();
    }

    fn add_connector(&mut self, remote: bool, name: String, target: String, env: String, cx: &mut Context<Self>) {
        let env: serde_json::Map<String, Value> = env
            .lines()
            .filter_map(|l| l.split_once('='))
            .map(|(k, v)| (k.trim().to_string(), Value::String(v.trim().to_string())))
            .filter(|(k, _)| !k.is_empty())
            .collect();
        let mut parts = target.split_whitespace().map(str::to_string);
        let body = if remote {
            json!({ "projectId": null, "name": name, "command": "", "args": [], "url": target.trim(), "env": env, "mode": "approve" })
        } else {
            let command = parts.next().unwrap_or_default();
            json!({ "projectId": null, "name": name, "command": command, "args": parts.collect::<Vec<_>>(), "url": "", "env": env, "mode": "approve" })
        };
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let ok = matches!(
                runtime::spawn(async move { http.post::<_, Value>("/api/mcp", &body).await }).await,
                Ok(Ok(_))
            );
            let _ = this.update(cx, |this, cx| {
                if ok {
                    this.connectors.error = None;
                } else {
                    this.connectors.error = Some(t!("mcp.updateFailed", name = "").into_owned());
                }
                this.load_connectors(cx);
                cx.notify();
            });
        })
        .detach();
    }

    /// Connectors you added yourself (any MCP server, local or remote), at the end of Settings › Connectors: their
    /// list, the form while adding one, and "Add a custom connector".
    pub(super) fn custom_connectors(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.connectors.list.is_none() {
            self.connectors.list = Some(Vec::new());
            self.load_connectors(cx);
        }
        let list: Vec<McpServer> = self
            .connectors
            .list
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| super::connectors::catalog_of(s).is_none())
            .collect();
        let rows: Vec<AnyElement> = list
            .iter()
            .map(|s| {
                let (on_id, mode_id, test_id, rm_id, sign_id) =
                    (s.id.clone(), s.id.clone(), s.id.clone(), s.id.clone(), s.id.clone());
                let enabled = s.enabled;
                let at = MODES.iter().position(|(m, _)| *m == s.mode).unwrap_or(1);
                let view = cx.entity().downgrade();
                let tested = self.connectors.tested.get(&s.id).cloned();
                let oauth = matches!(s.auth, crate::net::types::McpServerAuth::Oauth);
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .p(px(space::X3))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X3))
                            .child(icon(IconName::Plug, icon::MD).text_color(p.text_muted))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .child(div().font_weight(FontWeight::MEDIUM).child(s.name.clone()))
                                    .child(
                                        div()
                                            .truncate()
                                            .font_family(crate::ui::code::MONO)
                                            .text_xs()
                                            .text_color(p.text_muted)
                                            .child(if s.url.is_empty() {
                                                format!("{} {}", s.command, s.args.join(" "))
                                            } else {
                                                s.url.clone()
                                            }),
                                    ),
                            )
                            .child(switch(
                                SharedString::from(format!("mcp-on-{}", s.id)),
                                String::new(),
                                enabled,
                                Rc::new(move |on, _, cx| {
                                    let id = on_id.clone();
                                    let _ = view
                                        .update(cx, |this, cx| this.patch_connector(id, json!({ "enabled": on }), cx));
                                }),
                                window,
                                cx,
                            )),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X2))
                            .child(Segmented::new(
                                SharedString::from(format!("mcp-mode-{}", s.id)),
                                t!("mcp.mode").into_owned(),
                                MODES
                                    .iter()
                                    .map(|(_, k)| SharedString::from(t!(format!("mcp.modes.{k}")).into_owned()))
                                    .collect(),
                                at,
                                Rc::new({
                                    let view = cx.entity().downgrade();
                                    move |i, _, cx| {
                                        let id = mode_id.clone();
                                        let _ = view.update(cx, |this, cx| {
                                            this.patch_connector(id, json!({ "mode": MODES[i].1 }), cx)
                                        });
                                    }
                                }),
                            ))
                            .child(div().flex_1())
                            .when(oauth, |d| {
                                d.child(
                                    Button::new(
                                        SharedString::from(format!("mcp-sign-{}", s.id)),
                                        t!("providers.signInAction").into_owned(),
                                    )
                                    .variant(Variant::Ghost)
                                    .size(Size::Sm)
                                    .on_click(
                                        cx.listener(move |this, _, _, cx| this.sign_in_connector(sign_id.clone(), cx)),
                                    ),
                                )
                            })
                            .child(
                                Button::new(
                                    SharedString::from(format!("mcp-test-{}", s.id)),
                                    t!("mcp.test").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| this.test_connector(test_id.clone(), cx))),
                            )
                            .child(
                                Button::new(
                                    SharedString::from(format!("mcp-rm-{}", s.id)),
                                    t!("common.remove").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| this.remove_connector(rm_id.clone(), cx))),
                            ),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(p.text_muted)
                            .child(t!(format!("mcp.modeHints.{}", MODES[at].1)).into_owned()),
                    )
                    .when_some(tested, |d, line| {
                        d.child(div().text_sm().text_color(p.text_secondary).child(line))
                    })
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(space::X3))
            .when(!rows.is_empty(), |d| {
                d.child(super::list(
                    t!("settings.customConnectors").into_owned(),
                    rows,
                    space::X3,
                    p,
                ))
            })
            .child(
                div().flex().child(
                    Button::new("mcp-add-custom", t!("settings.addCustom").into_owned())
                        .icon(IconName::Plus)
                        .variant(Variant::Secondary)
                        .size(Size::Sm)
                        .on_click(
                            cx.listener(|_, _, window, cx| Settings::custom_connector_dialog(&cx.entity(), window, cx)),
                        ),
                ),
            )
            .into_any_element()
    }
}

impl Settings {
    /// "Add a custom connector": a dialog for any MCP server, local (a command) or remote (a URL), its name, the
    /// environment it needs (secrets go to the system keychain), and what each permission means.
    pub fn custom_connector_dialog(settings: &Entity<Settings>, window: &mut Window, cx: &mut App) {
        let settings = settings.clone();
        let name = cx.new(|cx| InputState::new(window, cx).placeholder(t!("mcp.namePlaceholder").into_owned()));
        let target = cx.new(|cx| InputState::new(window, cx).placeholder(t!("mcp.commandHint").into_owned()));
        let env = cx.new(|cx| {
            let mut t = TextareaState::new(window, cx).placeholder(t!("mcp.envHint").into_owned());
            t.set_auto_grow(2, 6, cx);
            t
        });
        let remote = Rc::new(std::cell::Cell::new(false));
        let focus = std::cell::Cell::new(true);
        window.open_dialog(cx, move |dialog, window, cx| {
            if focus.replace(false) {
                name.focus_handle(cx).focus(window, cx);
            }
            let p = theme::palette(window);
            let framed = |el: AnyElement| {
                div()
                    .px(px(space::X2_5))
                    .py(px(space::X1_5))
                    .rounded(px(crate::theme::tokens::RADIUS_CONTROL))
                    .border_1()
                    .border_color(p.border_strong)
                    .bg(p.bg_field)
                    .child(el)
                    .into_any_element()
            };
            let pick = remote.clone();
            let kind = Segmented::new(
                "mcp-new-type",
                t!("mcp.type").into_owned(),
                vec![
                    SharedString::from(t!("mcp.local").into_owned()),
                    SharedString::from(t!("mcp.remote").into_owned()),
                ],
                usize::from(remote.get()),
                Rc::new(move |i, window, _| {
                    pick.set(i == 1);
                    window.refresh();
                }),
            );
            let modes = div()
                .flex()
                .flex_col()
                .gap(px(space::X1_5))
                .text_sm()
                .child(div().text_color(p.text_muted).child(t!("mcp.modesTitle").into_owned()))
                .children(MODES.iter().map(|(_, k)| {
                    div()
                        .flex()
                        .gap(px(space::X4))
                        .child(
                            div()
                                .flex_none()
                                .w(px(150.))
                                .font_weight(FontWeight::MEDIUM)
                                .child(t!(format!("mcp.modes.{k}")).into_owned()),
                        )
                        .child(
                            div()
                                .text_color(p.text_secondary)
                                .child(t!(format!("mcp.modeHints.{k}")).into_owned()),
                        )
                }));
            let body = div()
                .flex()
                .flex_col()
                .gap(px(space::X4))
                .child(div().flex().child(kind))
                .child(crate::ui::drawer::field(
                    t!("mcp.name").into_owned(),
                    None,
                    framed(Input::new(&name).appearance(false).into_any_element()),
                    window,
                ))
                .child(crate::ui::drawer::field(
                    if remote.get() { t!("mcp.url") } else { t!("mcp.command") }.into_owned(),
                    None,
                    framed(Input::new(&target).appearance(false).into_any_element()),
                    window,
                ))
                .child(crate::ui::drawer::field(
                    t!("mcp.env").into_owned(),
                    None,
                    framed(Textarea::new(&env).into_any_element()),
                    window,
                ))
                .child(modes);
            let ready = !name.read(cx).value().trim().is_empty() && !target.read(cx).value().trim().is_empty();
            let (n2, t2, e2, r2, s2) = (
                name.clone(),
                target.clone(),
                env.clone(),
                remote.clone(),
                settings.clone(),
            );
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Lg,
                crate::ui::dialog::Sheet {
                    title: t!("settings.addCustom").into_owned(),
                    description: None,
                    body: Some(body.into_any_element()),
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("create", t!("mcp.add").into_owned())
                            .variant(Variant::Primary)
                            .disabled(!ready)
                            .on_click(move |_, window, cx| {
                                let (n, tg, e) = (
                                    n2.read(cx).value().trim().to_string(),
                                    t2.read(cx).value().trim().to_string(),
                                    e2.read(cx).value().to_string(),
                                );
                                if n.is_empty() || tg.is_empty() {
                                    return;
                                }
                                window.close_dialog(cx);
                                let remote = r2.get();
                                s2.update(cx, |this, cx| this.add_connector(remote, n, tg, e, cx));
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }
}
