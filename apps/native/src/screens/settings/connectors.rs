// Settings › Connectors (apps/web/src/features/mcp.tsx › Connectors, the prototype's "Connectors"): apps the agents
// can reach. Connected ones first (what it is, its mode, Manage: test, reconnect, disconnect); then the catalog not
// connected yet as cards with Connect: OAuth ones sign in in the browser (Zorel looks again every few seconds until
// the sign-in lands), GitHub takes a personal token (with where to make one), the rest need nothing and are tested at
// once. Writes always wait for approval (mode "approve" on connect). Custom servers live in Settings › MCP servers.
use super::*;

use crate::assets::GRAPHITE;

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

/// Each connector's brand colour (Simple Icons' hex; a black or near-white brand on a tone that shows on the dark
/// canvas behind a white logo).
const TINTS: [(&str, u32); 22] = [
    ("github", GRAPHITE),
    ("notion", GRAPHITE),
    ("linear", 0x5E6AD2),
    ("atlassian", 0x0052CC),
    ("sentry", 0x362D59),
    ("vercel", GRAPHITE),
    ("supabase", 0x3FCF8E),
    ("stripe", 0x635BFF),
    ("todoist", 0xE44332),
    ("clickup", 0x7B68EE),
    ("monday", 0xFF3D57),
    ("airtable", 0x18BFFF),
    ("intercom", 0x1F8DED),
    ("canva", 0x00C4CC),
    ("gamma", 0x6C47FF),
    ("webflow", 0x146EF5),
    ("wix", 0x0C6EFC),
    ("paypal", 0x003087),
    ("square", 0x3E4348),
    ("huggingface", 0xFF9D00),
    ("context7", GRAPHITE),
    ("figma", 0xF24E1E),
];

/// What a connector may do, as an icon (read only, write with your approval, write freely), in MODES' order.
const MODE_ICONS: [IconName; 3] = [IconName::Eye, IconName::ShieldCheck, IconName::Zap];

/// A connector's tile: its brand colour with its logo (or initial) in white.
fn mark(c: &Connector) -> AnyElement {
    let tint = TINTS.iter().find(|(id, _)| *id == c.id).map_or(GRAPHITE, |(_, t)| *t);
    crate::ui::brand::tile(crate::assets::connector_mark(c.id), c.name, tint, 24.)
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
        // A connected one: a taller card in the same grid, its state below (connected, finish setup, waiting) with
        // what it may do, and a gear whose menu holds the permission, a test, reconnect and disconnect.
        let connected_cards: Vec<AnyElement> = connected
            .iter()
            .map(|(c, s)| {
                let c: &'static Connector = c;
                // Refused (expired or denied): sign in again; an OAuth one never signed in: finish setting it up.
                let refused = self.connectors.refused.contains(&s.id);
                let unsigned = matches!(s.auth, McpServerAuth::Oauth) && !self.connectors.signed_in.contains(&s.id);
                let attention = refused || unsigned;
                let waiting = self.connectors.waiting.as_deref() == Some(s.id.as_str());
                let mode_at = servers::MODES.iter().position(|(m, _)| *m == s.mode).unwrap_or(1);
                let mode_key = servers::MODES[mode_at].1;
                let (dot, state) = if waiting {
                    (p.text_dim, t!("connectors.waiting").into_owned())
                } else if refused {
                    (p.warning, t!("connectors.attention").into_owned())
                } else if unsigned {
                    (p.warning, t!("connectors.notSignedIn").into_owned())
                } else {
                    (p.success, t!("connectors.connected").into_owned())
                };
                let tested = self.connectors.tested.get(&s.id).cloned();
                let view = cx.entity().downgrade();
                let id = s.id.clone();
                let items: crate::ui::menu::Items = Rc::new(move || {
                    let mut m = crate::ui::menu::Menu::default();
                    for (i, (_, k)) in servers::MODES.iter().enumerate() {
                        let (view, id) = (view.clone(), id.clone());
                        m = m.item(t!(format!("mcp.modes.{k}")).into_owned(), move |_, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.patch_connector(id.clone(), json!({ "mode": servers::MODES[i].1 }), cx)
                            });
                        });
                        if i == mode_at {
                            m = m.icon(IconName::Check);
                        }
                    }
                    let (v1, i1) = (view.clone(), id.clone());
                    m = m.separator().item(t!("connectors.test").into_owned(), move |_, cx| {
                        let _ = v1.update(cx, |this, cx| this.test_connector(i1.clone(), cx));
                    });
                    if c.auth != Auth::None {
                        let v2 = view.clone();
                        m = m.item(t!("connectors.reconnect").into_owned(), move |_, cx| {
                            let _ = v2.update(cx, |this, cx| {
                                if c.auth == Auth::Token {
                                    this.connectors.token_for = Some(c.id);
                                    cx.notify();
                                } else {
                                    this.connect(c, None, cx);
                                }
                            });
                        });
                    }
                    let (v3, i3) = (view.clone(), id.clone());
                    m.separator()
                        .danger(t!("connectors.disconnect").into_owned(), move |_, cx| {
                            let _ = v3.update(cx, |this, cx| this.remove_connector(i3.clone(), cx));
                        })
                        .build()
                });
                let gear = crate::ui::menu::dropdown(
                    SharedString::from(format!("conn-gear-{}", s.id)),
                    Button::icon_only(
                        SharedString::from(format!("conn-gear-btn-{}", s.id)),
                        IconName::Settings,
                        t!("settings.manage").into_owned(),
                    )
                    .size(Size::Xs),
                    items,
                );
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X3))
                    .px(px(14.))
                    .py(px(space::X3))
                    .rounded(px(12.))
                    .bg(p.bg_surface)
                    .border_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X3))
                            .child(mark(c))
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
                            .child(gear),
                    )
                    // Below: its state (a link to finish signing in when it needs one) and what it may do, as an icon.
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X2))
                            .pt(px(space::X2_5))
                            .border_t_1()
                            .border_color(super::divider(p))
                            .text_xs()
                            .child(div().size(px(6.)).rounded_full().bg(dot))
                            .map(|d| {
                                if attention && !waiting {
                                    let id = s.id.clone();
                                    d.child(
                                        div()
                                            .id(SharedString::from(format!("conn-finish-{}", s.id)))
                                            .text_color(p.warning)
                                            .cursor_pointer()
                                            .hover(|t| t.underline())
                                            .child(state)
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                // The provider's page opens; the card waits until the sign-in lands.
                                                this.sign_in_connector(id.clone(), cx);
                                                this.connectors.waiting = Some(id.clone());
                                                this.watch_sign_in(cx);
                                                cx.notify();
                                            })),
                                    )
                                } else {
                                    d.child(div().text_color(p.text_secondary).child(state))
                                }
                            })
                            .child(div().flex_1())
                            .child(
                                Button::icon_only(
                                    SharedString::from(format!("conn-mode-icon-{}", s.id)),
                                    MODE_ICONS[mode_at],
                                    t!(format!("mcp.modes.{mode_key}")).into_owned(),
                                )
                                .size(Size::Xs)
                                .tooltip(t!(format!("mcp.modes.{mode_key}")).into_owned()),
                            ),
                    )
                    .when_some(tested, |d, line| {
                        d.child(div().text_xs().text_color(p.text_secondary).child(line))
                    })
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
                            .child(mark(c))
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
            .when_some(self.connectors.error.clone(), |d, e| {
                d.child(div().text_sm().text_color(p.danger).child(e))
            })
            .child(
                div().flex().flex_col().gap(px(space::X2_5)).child(
                    div()
                        .grid()
                        .grid_cols(2)
                        .gap(px(space::X2_5))
                        .children(connected_cards)
                        .children(cards),
                ),
            )
            .child(self.custom_connectors(window, cx))
            .into_any_element()
    }
}
