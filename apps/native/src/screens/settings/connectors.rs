// Settings › Connectors (apps/web/src/features/mcp.tsx › Connectors, the prototype's "Connectors"): apps the agents
// can reach. Connected ones first (what it is, its mode, Manage: test, reconnect, disconnect); then the catalog not
// connected yet as cards with Connect: OAuth ones sign in in the browser (Zorel looks again every few seconds until
// the sign-in lands), GitHub takes a personal token (with where to make one), the rest need nothing and are tested at
// once. Writes always wait for approval (mode "approve" on connect). Custom servers live in Settings › MCP servers.
use super::*;

use crate::{
    net::types::{McpServer, McpServerAuth},
    ui::button::{Button, Size, Variant},
};
use gpui_kit::component::input::{Input, InputState};

#[derive(Clone, Copy, PartialEq)]
enum Auth {
    Oauth,
    Token,
    None,
}

pub struct Connector {
    pub id: &'static str,
    pub name: &'static str,
    url: &'static str,
    auth: Auth,
    token_url: Option<&'static str>,
}

/// A hosted server that signs in with OAuth.
const fn hosted(id: &'static str, name: &'static str, url: &'static str) -> Connector {
    Connector {
        id,
        name,
        url,
        auth: Auth::Oauth,
        token_url: None,
    }
}

/// A server that needs no sign-in.
const fn open(id: &'static str, name: &'static str, url: &'static str) -> Connector {
    Connector {
        id,
        name,
        url,
        auth: Auth::None,
        token_url: None,
    }
}

/// The catalog (the web's CONNECTORS): hosted servers that sign in with OAuth, GitHub with a token, a few that need
/// nothing.
pub const CATALOG: [Connector; 22] = [
    Connector {
        id: "github",
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
        auth: Auth::Token,
        token_url: Some("https://github.com/settings/personal-access-tokens/new"),
    },
    hosted("notion", "Notion", "https://mcp.notion.com/mcp"),
    hosted("linear", "Linear", "https://mcp.linear.app/mcp"),
    hosted("atlassian", "Jira & Confluence", "https://mcp.atlassian.com/v1/mcp"),
    hosted("sentry", "Sentry", "https://mcp.sentry.dev/mcp"),
    hosted("vercel", "Vercel", "https://mcp.vercel.com"),
    hosted("supabase", "Supabase", "https://mcp.supabase.com/mcp"),
    hosted("stripe", "Stripe", "https://mcp.stripe.com"),
    hosted("todoist", "Todoist", "https://ai.todoist.net/mcp"),
    hosted("clickup", "ClickUp", "https://mcp.clickup.com/mcp"),
    hosted("monday", "monday.com", "https://mcp.monday.com/mcp"),
    hosted("airtable", "Airtable", "https://mcp.airtable.com/mcp"),
    hosted("intercom", "Intercom", "https://mcp.intercom.com/mcp"),
    hosted("canva", "Canva", "https://mcp.canva.com/mcp"),
    hosted("gamma", "Gamma", "https://mcp.gamma.app/mcp"),
    hosted("webflow", "Webflow", "https://mcp.webflow.com/mcp"),
    hosted("wix", "Wix", "https://mcp.wix.com/mcp"),
    hosted("paypal", "PayPal", "https://mcp.paypal.com/mcp"),
    hosted("square", "Square", "https://mcp.squareup.com/mcp"),
    open("huggingface", "Hugging Face", "https://huggingface.co/mcp"),
    open("context7", "Context7", "https://mcp.context7.com/mcp"),
    open("figma", "Figma", "http://127.0.0.1:3845/mcp"),
];

/// The catalog entry a server was added from, if any.
pub fn catalog_of(s: &McpServer) -> Option<&'static Connector> {
    CATALOG.iter().find(|c| s.url == c.url)
}

/// A connector's mark: its initial on a soft square (brand logos aren't bundled).
fn monogram(name: &str, p: &theme::tokens::Palette) -> Div {
    div()
        .flex_none()
        .size(px(24.))
        .rounded(px(6.))
        .bg(p.bg_control)
        .flex()
        .items_center()
        .justify_center()
        .text_sm()
        .font_weight(FontWeight::SEMIBOLD)
        .child(name.chars().next().unwrap_or('?').to_string())
}

impl Settings {
    /// Connects one from the catalog: create it, then sign in (OAuth) or test it (token, none).
    fn connect(&mut self, c: &'static Connector, token: Option<String>, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        let existing = self
            .connectors
            .list
            .as_deref()
            .unwrap_or_default()
            .iter()
            .find(|s| catalog_of(s).is_some_and(|x| x.id == c.id))
            .map(|s| s.id.clone());
        let env = token
            .map(|t| json!({ "Authorization": format!("Bearer {}", t.trim()) }))
            .unwrap_or(json!({}));
        let body = json!({
            "projectId": null, "name": c.name, "command": "", "args": [],
            "url": c.url, "env": env, "mode": "approve", "auth": if c.auth == Auth::Oauth { "oauth" } else { "none" },
        });
        let auth = c.auth;
        cx.spawn(async move |this, cx| {
            let made = runtime::spawn(async move {
                let id = match existing {
                    Some(id) => {
                        if auth == Auth::Token {
                            http.patch::<_, Value>(&format!("/api/mcp/{id}"), &json!({ "env": env }))
                                .await
                                .map_err(|e| e.to_string())?;
                        }
                        id
                    }
                    None => {
                        http.post::<_, McpServer>("/api/mcp", &body)
                            .await
                            .map_err(|e| e.to_string())?
                            .id
                    }
                };
                let url = if auth == Auth::Oauth {
                    http.post::<_, Value>(&format!("/api/mcp/{id}/sign-in"), &json!({}))
                        .await
                        .ok()
                        .and_then(|v| v["authorizeUrl"].as_str().map(str::to_string))
                } else {
                    None
                };
                Ok::<_, String>((id, url))
            })
            .await;
            let _ = this.update(cx, |this, cx| {
                match made {
                    Ok(Ok((id, url))) => {
                        if let Some(url) = url {
                            cx.open_url(&url);
                            this.connectors.waiting = Some(id);
                            this.watch_sign_in(cx);
                        } else {
                            this.test_connector(id, cx);
                        }
                        this.connectors.token_for = None;
                    }
                    _ => this.connectors.error = Some(t!("connectors.failed").into_owned()),
                }
                this.load_connectors(cx);
                this.load_signed_in(cx);
            });
        })
        .detach();
    }

    pub(super) fn load_signed_in(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(v)) = runtime::spawn(async move { http.get::<Value>("/api/mcp/signed-in").await }).await {
                let list = |k: &str| {
                    v[k].as_array()
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                        .unwrap_or_default()
                };
                let _ = this.update(cx, |this, cx| {
                    this.connectors.signed_in = list("signedIn");
                    this.connectors.refused = list("refused");
                    if this
                        .connectors
                        .waiting
                        .as_ref()
                        .is_some_and(|w| this.connectors.signed_in.contains(w))
                    {
                        this.connectors.waiting = None;
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }

    /// While a sign-in is open in the browser: look again every 2 s, for up to 5 minutes.
    fn watch_sign_in(&mut self, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            for _ in 0..150 {
                cx.background_executor().timer(std::time::Duration::from_secs(2)).await;
                let Ok(still) = this.update(cx, |this, cx| {
                    this.load_signed_in(cx);
                    this.connectors.waiting.is_some()
                }) else {
                    return;
                };
                if !still {
                    return;
                }
            }
            let _ = this.update(cx, |this, cx| {
                this.connectors.waiting = None;
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn connectors_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if !self.connectors.asked_signed_in {
            self.connectors.asked_signed_in = true;
            self.load_signed_in(cx);
        }
        let servers = self.connectors.list.clone().unwrap_or_default();
        let connected: Vec<(&'static Connector, McpServer)> = servers
            .iter()
            .filter_map(|s| catalog_of(s).map(|c| (c, s.clone())))
            .collect();
        let rows: Vec<AnyElement> = connected
            .iter()
            .map(|(c, s)| {
                let attention = self.connectors.refused.contains(&s.id)
                    || (matches!(s.auth, McpServerAuth::Oauth) && !self.connectors.signed_in.contains(&s.id));
                let waiting = self.connectors.waiting.as_deref() == Some(s.id.as_str());
                let open = self.connectors.managing.as_deref() == Some(s.id.as_str());
                let mode_at = servers::MODES.iter().position(|(m, _)| *m == s.mode).unwrap_or(1);
                let (mode_id, manage_id) = (s.id.clone(), s.id.clone());
                let view = cx.entity().downgrade();
                let mode = Select::new(
                    SharedString::from(format!("conn-mode-{}", s.id)),
                    t!("mcp.mode").into_owned(),
                    servers::MODES
                        .iter()
                        .map(|(_, k)| SelectOption {
                            id: k.to_string(),
                            label: t!(format!("mcp.modes.{k}")).into_owned().into(),
                            mark: select::Mark::None,
                        })
                        .collect(),
                    servers::MODES[mode_at].1,
                    Rc::new(move |v, _, cx| {
                        let (id, v) = (mode_id.clone(), v.to_string());
                        let _ = view.update(cx, |this, cx| this.patch_connector(id, json!({ "mode": v }), cx));
                    }),
                );
                let status = if waiting {
                    (t!("connectors.waiting").into_owned(), p.text_muted)
                } else if attention {
                    (t!("connectors.attention").into_owned(), p.warning)
                } else {
                    (
                        format!(
                            "{} · {}",
                            t!(format!("connectors.about.{}", c.id)),
                            t!("connectors.connected")
                        ),
                        p.text_muted,
                    )
                };
                let tested = self.connectors.tested.get(&s.id).cloned();
                let (test_id, rm_id) = (s.id.clone(), s.id.clone());
                let manage = open.then(|| {
                    let c: &'static Connector = c;
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(space::X2))
                        .pl(px(38.))
                        .child(
                            Button::new(
                                SharedString::from(format!("conn-test-{}", s.id)),
                                t!("connectors.test").into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| this.test_connector(test_id.clone(), cx))),
                        )
                        .when(c.auth != Auth::None, |d| {
                            d.child(
                                Button::new(
                                    SharedString::from(format!("conn-again-{}", s.id)),
                                    t!("connectors.reconnect").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if c.auth == Auth::Token {
                                        this.connectors.token_for = Some(c.id);
                                        cx.notify();
                                    } else {
                                        this.connect(c, None, cx);
                                    }
                                })),
                            )
                        })
                        .child(
                            Button::new(
                                SharedString::from(format!("conn-rm-{}", s.id)),
                                t!("connectors.disconnect").into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_connector(rm_id.clone(), cx))),
                        )
                        .when_some(tested, |d, line| {
                            d.child(div().w_full().text_sm().text_color(p.text_secondary).child(line))
                        })
                });
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .py(px(space::X3))
                    .border_b_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X3))
                            .child(monogram(c.name, p))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .child(div().font_weight(FontWeight::MEDIUM).child(c.name))
                                    .child(div().truncate().text_sm().text_color(status.1).child(status.0)),
                            )
                            .child(mode)
                            .child(
                                Button::new(
                                    SharedString::from(format!("conn-manage-{}", s.id)),
                                    t!("settings.manage").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.connectors.managing =
                                        if this.connectors.managing.as_deref() == Some(manage_id.as_str()) {
                                            None
                                        } else {
                                            Some(manage_id.clone())
                                        };
                                    cx.notify();
                                })),
                            ),
                    )
                    .children(manage)
                    .into_any_element()
            })
            .collect();
        // The catalog not connected yet, as cards.
        let token_for = self.connectors.token_for;
        let cards: Vec<AnyElement> = CATALOG
            .iter()
            .filter(|c| !connected.iter().any(|(x, _)| x.id == c.id))
            .map(|c| {
                let asking = token_for == Some(c.id);
                let field = asking.then(|| {
                    let input =
                        window.use_keyed_state(SharedString::from(format!("token-{}", c.id)), cx, |window, cx| {
                            InputState::new(window, cx)
                                .masked(true)
                                .placeholder(t!("connectors.tokenPlaceholder").into_owned())
                        });
                    let send = input.clone();
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(space::X2))
                        .child(
                            div()
                                .h(px(crate::theme::tokens::CONTROL_H_SM))
                                .px(px(space::X2_5))
                                .flex()
                                .items_center()
                                .rounded(px(crate::theme::tokens::RADIUS_CONTROL_SM))
                                .border_1()
                                .border_color(p.border)
                                .bg(p.bg_field)
                                .text_sm()
                                .child(div().flex_1().child(Input::new(&input).appearance(false))),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(space::X2))
                                .when_some(c.token_url, |d, url| {
                                    d.child(
                                        Button::new(
                                            SharedString::from(format!("token-make-{}", c.id)),
                                            t!("connectors.createToken").into_owned(),
                                        )
                                        .icon(IconName::ExternalLink)
                                        .variant(Variant::Ghost)
                                        .size(Size::Xs)
                                        .on_click(move |_, _, cx| cx.open_url(url)),
                                    )
                                })
                                .child(div().flex_1())
                                .child(
                                    Button::new(
                                        SharedString::from(format!("token-go-{}", c.id)),
                                        t!("connectors.connect").into_owned(),
                                    )
                                    .variant(Variant::Primary)
                                    .size(Size::Sm)
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| {
                                            let token = send.read(cx).value().trim().to_string();
                                            if !token.is_empty() {
                                                this.connect(c, Some(token), cx);
                                            }
                                        },
                                    )),
                                ),
                        )
                });
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .px(px(14.))
                    .py(px(space::X3))
                    .rounded(px(12.))
                    .border_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X3))
                            .child(monogram(c.name, p))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .child(div().font_weight(FontWeight::MEDIUM).child(c.name))
                                    .child(
                                        div()
                                            .truncate()
                                            .text_xs()
                                            .text_color(p.text_muted)
                                            .child(t!(format!("connectors.about.{}", c.id)).into_owned()),
                                    ),
                            )
                            .when(!asking, |d| {
                                d.child(
                                    Button::new(
                                        SharedString::from(format!("conn-add-{}", c.id)),
                                        t!("connectors.connect").into_owned(),
                                    )
                                    .variant(Variant::Secondary)
                                    .size(Size::Xs)
                                    .on_click(cx.listener(
                                        move |this, _, _, cx| {
                                            if c.auth == Auth::Token {
                                                this.connectors.token_for = Some(c.id);
                                                cx.notify();
                                            } else {
                                                this.connect(c, None, cx);
                                            }
                                        },
                                    )),
                                )
                            }),
                    )
                    .children(field)
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("connectors.intro").into_owned()),
            )
            .when_some(self.connectors.error.clone(), |d, e| {
                d.child(div().text_sm().text_color(p.danger).child(e))
            })
            .when(!rows.is_empty(), |d| {
                d.child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_sm()
                                .text_color(p.text_muted)
                                .pb(px(space::X1))
                                .child(t!("settings.connected").into_owned()),
                        )
                        .children(rows),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2_5))
                    .child(
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("settings.availableConnectors").into_owned()),
                    )
                    .child(div().grid().grid_cols(2).gap(px(space::X2_5)).children(cards)),
            )
            .into_any_element()
    }
}
