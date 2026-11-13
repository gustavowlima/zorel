// Settings › Providers (apps/web/src/features/providers.tsx): every way Zorel reaches a model, one card each. A
// subscription provider lists its accounts (signed in as whom, or not; Sign in / Reconnect opens the provider's login
// page, and when the page shows a code it's pasted here; Remove, never the default; Add account), its limit windows,
// and its API key instead (saved in the system keychain; Replace / Remove). A local server says whether it runs; an
// agent CLI whether it's installed. Zorel never reads a CLI's login: it only shows who is connected.
use super::*;

use crate::{
    labels::{pace_of, tone_of, window_label},
    net::types::{KeyInfo, ProviderAccount, ProviderAccountKind},
    ui::button::{Button, Size, Variant},
};
use gpui_kit::component::input::{Input, InputState};

struct Provider {
    id: &'static str,
    mark: &'static str,
    /// Signs in with an official CLI (its accounts' provider).
    account: Option<&'static str>,
    key: Option<&'static str>,
    harnesses: &'static [&'static str],
    key_url: Option<&'static str>,
}

const PROVIDERS: [Provider; 8] = [
    Provider {
        id: "claude",
        mark: "claude",
        account: Some("claude"),
        key: Some("ANTHROPIC_API_KEY"),
        harnesses: &["claude-cli", "anthropic"],
        key_url: Some("https://console.anthropic.com/settings/keys"),
    },
    Provider {
        id: "chatgpt",
        mark: "codex",
        account: Some("codex"),
        key: Some("OPENAI_API_KEY"),
        harnesses: &["codex-cli", "openai"],
        key_url: Some("https://platform.openai.com/api-keys"),
    },
    Provider {
        id: "openrouter",
        mark: "openrouter",
        account: None,
        key: Some("OPENROUTER_API_KEY"),
        harnesses: &["openrouter"],
        key_url: Some("https://openrouter.ai/keys"),
    },
    Provider {
        id: "ollama",
        mark: "ollama",
        account: None,
        key: None,
        harnesses: &["ollama"],
        key_url: None,
    },
    Provider {
        id: "lmstudio",
        mark: "lmstudio",
        account: None,
        key: None,
        harnesses: &["lmstudio"],
        key_url: None,
    },
    Provider {
        id: "gemini",
        mark: "gemini-cli",
        account: None,
        key: None,
        harnesses: &["gemini-cli"],
        key_url: None,
    },
    Provider {
        id: "opencode",
        mark: "opencode",
        account: None,
        key: None,
        harnesses: &["opencode"],
        key_url: None,
    },
    Provider {
        id: "antigravity",
        mark: "antigravity",
        account: Some("antigravity"),
        key: None,
        harnesses: &["antigravity"],
        key_url: None,
    },
];

#[derive(Default)]
pub struct Providers {
    keys: Option<Vec<KeyInfo>>,
    /// The open card.
    open: Option<&'static str>,
    /// Accounts whose login waits for a pasted code.
    waiting: std::collections::HashSet<String>,
    error: Option<String>,
}

impl Settings {
    fn load_keys(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(k)) = runtime::spawn(async move { http.get::<Vec<KeyInfo>>("/api/keys").await }).await {
                let _ = this.update(cx, |this, cx| {
                    this.providers.keys = Some(k);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn reload_accounts(&self, cx: &mut Context<Self>) {
        self.store.update(cx, |s, cx| s.load(cx));
    }

    fn sign_in(&mut self, account: &ProviderAccount, cx: &mut Context<Self>) {
        let (http, id) = (self.store.read(cx).http.clone(), account.id.clone());
        self.providers.error = None;
        cx.spawn(async move |this, cx| {
            let path = format!("/api/accounts/{id}/login");
            let got = runtime::spawn(async move { http.post::<_, Value>(&path, &json!({})).await }).await;
            let _ = this.update(cx, |this, cx| {
                match got {
                    Ok(Ok(v)) => {
                        if let Some(url) = v["url"].as_str() {
                            cx.open_url(url);
                        }
                        // A server-side login shows a code to paste back (the CLI waits for it).
                        if v["output"].is_string() || v["url"].is_null() {
                            this.providers.waiting.insert(id.clone());
                        }
                    }
                    _ => this.providers.error = Some(t!("accounts.busy").into_owned()),
                }
                this.reload_accounts(cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn send_code(&mut self, id: String, code: String, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let path = format!("/api/accounts/{id}/login/code");
            let ok = matches!(
                runtime::spawn(async move { http.post::<_, Value>(&path, &json!({ "code": code })).await }).await,
                Ok(Ok(_))
            );
            let _ = this.update(cx, |this, cx| {
                this.providers.waiting.remove(&id);
                if !ok {
                    this.providers.error = Some(t!("accounts.codeFailed").into_owned());
                }
                this.reload_accounts(cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn add_account(&mut self, provider: &'static str, name: String, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        let count = self
            .store
            .read(cx)
            .accounts
            .iter()
            .filter(|a| a.provider == provider)
            .count();
        let label = format!("{name} {}", count + 1);
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move {
                http.post::<_, ProviderAccount>("/api/accounts", &json!({ "provider": provider, "label": label }))
                    .await
            })
            .await;
            let _ = this.update(cx, |this, cx| {
                match got {
                    Ok(Ok(a)) => this.sign_in(&a, cx),
                    _ => this.providers.error = Some(t!("accounts.addFailed").into_owned()),
                }
                this.reload_accounts(cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn remove_account(&mut self, id: String, cx: &mut Context<Self>) {
        // Gone at once; the reload brings it back if the engine refuses.
        self.store.update(cx, |s, cx| {
            s.accounts.retain(|a| a.id != id);
            cx.notify();
        });
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let path = format!("/api/accounts/{id}");
            let ok = matches!(runtime::spawn(async move { http.delete(&path).await }).await, Ok(Ok(_)));
            let _ = this.update(cx, |this, cx| {
                if !ok {
                    this.providers.error = Some(t!("accounts.removeFailed").into_owned());
                }
                this.reload_accounts(cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn set_key(&mut self, name: &'static str, value: String, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let path = format!("/api/keys/{name}");
            let _ = runtime::spawn(async move { http.put::<_, Value>(&path, &json!({ "value": value })).await }).await;
            let _ = this.update(cx, |this, cx| {
                this.load_keys(cx);
                this.store.update(cx, |s, cx| s.load(cx)); // models follow the keys
            });
        })
        .detach();
    }

    pub(super) fn providers_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.providers.keys.is_none() {
            self.providers.keys = Some(Vec::new());
            self.load_keys(cx);
        }
        let store = self.store.read(cx);
        let accounts = store.accounts.clone();
        let models = store.models.clone();
        let keys = self.providers.keys.clone().unwrap_or_default();
        let mut cards: Vec<AnyElement> = Vec::new();
        for pr in PROVIDERS.iter() {
            let mine: Vec<ProviderAccount> = pr
                .account
                .map(|a| accounts.iter().filter(|x| x.provider == a).cloned().collect())
                .unwrap_or_default();
            let key = pr.key.and_then(|k| keys.iter().find(|x| x.name == k).cloned());
            let available = models
                .iter()
                .filter(|m| pr.harnesses.iter().any(|h| m.id.starts_with(&format!("{h}/"))) && m.available)
                .count();
            let connected = mine.iter().any(|a| a.logged_in) || key.as_ref().is_some_and(|k| k.set) || available > 0;
            let name = t!(format!("providers.names.{}", pr.id)).into_owned();
            let status = if connected {
                t!("providers.isConnected")
            } else {
                t!("providers.notConnected")
            }
            .into_owned();
            let open = self.providers.open == Some(pr.id);
            let id = pr.id;
            let head = div()
                .id(SharedString::from(format!("provider-{id}")))
                .flex()
                .items_center()
                .gap(px(space::X3))
                .px(px(space::X4))
                .py(px(space::X3))
                .hover(|d| d.bg(p.bg_control))
                .child(crate::screens::model_picker::mark(pr.mark, 20., p.text))
                .child(div().flex_1().font_weight(FontWeight::MEDIUM).child(name.clone()))
                .child(
                    div()
                        .text_sm()
                        .text_color(if connected { p.success } else { p.text_muted })
                        .child(status),
                )
                .child(
                    icon(
                        if open {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        },
                        icon::XS,
                    )
                    .text_color(p.text_muted),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.providers.open = if this.providers.open == Some(id) {
                        None
                    } else {
                        Some(id)
                    };
                    cx.notify();
                }));
            let mut card = div()
                .flex()
                .flex_col()
                .rounded(px(crate::theme::tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .overflow_hidden()
                .child(head);
            if open {
                card = card.child(self.provider_body(pr, &name, &mine, key, available, window, cx));
            }
            cards.push(card.into_any_element());
        }
        div()
            .flex()
            .flex_col()
            .gap(px(space::X2))
            .when_some(self.providers.error.clone(), |d, e| {
                d.child(div().text_sm().text_color(p.danger).child(e))
            })
            .children(cards)
            .into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn provider_body(
        &mut self,
        pr: &'static Provider,
        name: &str,
        accounts: &[ProviderAccount],
        key: Option<KeyInfo>,
        available: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(space::X3))
            .px(px(space::X4))
            .py(px(space::X3))
            .border_t_1()
            .border_color(p.border);
        if let Some(provider) = pr.account {
            body = body.child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("accounts.intro").into_owned()),
            );
            for a in accounts
                .iter()
                .filter(|a| matches!(a.kind, ProviderAccountKind::Subscription))
            {
                body = body.child(self.account_row(a, window, cx));
            }
            let name = name.to_string();
            body = body.child(
                div().child(
                    Button::new(
                        SharedString::from(format!("add-account-{provider}")),
                        t!("accounts.add").into_owned(),
                    )
                    .icon(IconName::Plus)
                    .variant(Variant::Ghost)
                    .size(Size::Sm)
                    .on_click(cx.listener(move |this, _, _, cx| this.add_account(provider, name.clone(), cx))),
                ),
            );
        }
        if let Some(k) = pr.key {
            let field = window.use_keyed_state(SharedString::from(format!("key-{k}")), cx, |window, cx| {
                InputState::new(window, cx)
                    .masked(true)
                    .placeholder(t!("providers.pasteKey", name = name).into_owned())
            });
            let set = key.as_ref().is_some_and(|x| x.set);
            let (save, input) = (field.clone(), field.clone());
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X2))
                            .child(
                                div()
                                    .flex_1()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(t!("providers.apiKey").into_owned()),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if set { p.success } else { p.text_muted })
                                    .child(
                                        if set {
                                            t!("providers.keySaved")
                                        } else {
                                            t!("providers.noKey")
                                        }
                                        .into_owned(),
                                    ),
                            )
                            .when_some(pr.key_url, |d, url| {
                                d.child(
                                    Button::new(
                                        SharedString::from(format!("get-key-{k}")),
                                        t!("providers.getKey").into_owned(),
                                    )
                                    .icon(IconName::ExternalLink)
                                    .variant(Variant::Ghost)
                                    .size(Size::Xs)
                                    .on_click(move |_, _, cx| cx.open_url(url)),
                                )
                            }),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X2))
                            .child(
                                div()
                                    .flex_1()
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
                                Button::new(
                                    SharedString::from(format!("save-key-{k}")),
                                    if set {
                                        t!("providers.replaceKey")
                                    } else {
                                        t!("providers.addKey")
                                    }
                                    .into_owned(),
                                )
                                .variant(Variant::Secondary)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    let v = save.read(cx).value().trim().to_string();
                                    if !v.is_empty() {
                                        this.set_key(k, v, cx);
                                        save.update(cx, |s, cx| s.set_value(String::new(), window, cx));
                                    }
                                })),
                            )
                            .when(set && !key.as_ref().is_some_and(|x| x.from_env), |d| {
                                d.child(
                                    Button::new(
                                        SharedString::from(format!("clear-key-{k}")),
                                        t!("common.remove").into_owned(),
                                    )
                                    .variant(Variant::Ghost)
                                    .size(Size::Sm)
                                    .on_click(cx.listener(move |this, _, _, cx| this.set_key(k, String::new(), cx))),
                                )
                            }),
                    ),
            );
        }
        if pr.account.is_none() && pr.key.is_none() {
            body = body.child(
                div()
                    .text_sm()
                    .text_color(if available > 0 { p.success } else { p.text_muted })
                    .child(
                        if available > 0 {
                            t!("providers.running")
                        } else {
                            t!("providers.notRunning")
                        }
                        .into_owned(),
                    ),
            );
        }
        body = body.child(
            div()
                .text_sm()
                .text_color(p.text_muted)
                .child(format!("{} · {available}", t!("providers.models"))),
        );
        body.into_any_element()
    }

    fn account_row(&mut self, a: &ProviderAccount, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let waiting = self.providers.waiting.contains(&a.id);
        let status = if waiting {
            t!("accounts.waitingCode").into_owned()
        } else if a.logging_in {
            t!("accounts.signingIn").into_owned()
        } else if a.logged_in {
            a.identity
                .clone()
                .unwrap_or_else(|| t!("accounts.signedIn").into_owned())
        } else {
            t!("accounts.signedOut").into_owned()
        };
        let (acct, remove) = (a.clone(), a.id.clone());
        let now = format::now_ms();
        let windows: Vec<AnyElement> = a
            .usage
            .as_ref()
            .map(|u| u.windows.clone())
            .unwrap_or_default()
            .iter()
            .map(|w| {
                let pace = pace_of(&w.id, w.used_percent, w.resets_at, now);
                let color = match tone_of(&pace) {
                    crate::labels::Tone::Critical => p.danger,
                    crate::labels::Tone::Warning => p.warning,
                    _ => p.accent,
                };
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .text_xs()
                    .child(div().w(px(96.)).text_color(p.text_muted).child(window_label(&w.id)))
                    .child(
                        div().flex_1().h(px(4.)).rounded_full().bg(p.bg_control).child(
                            div()
                                .h_full()
                                .rounded_full()
                                .bg(color)
                                .w(relative((w.used_percent / 100.).clamp(0., 1.) as f32)),
                        ),
                    )
                    .child(
                        div()
                            .w(px(40.))
                            .text_right()
                            .text_color(p.text_muted)
                            .child(format::percent(w.used_percent / 100.)),
                    )
                    .into_any_element()
            })
            .collect();
        let code = window.use_keyed_state(SharedString::from(format!("code-{}", a.id)), cx, |window, cx| {
            InputState::new(window, cx).placeholder(t!("accounts.codePlaceholder").into_owned())
        });
        let (send, id_send) = (code.clone(), a.id.clone());
        div()
            .flex()
            .flex_col()
            .gap(px(space::X2))
            .p(px(space::X3))
            .rounded(px(crate::theme::tokens::RADIUS_CONTROL))
            .bg(p.bg_surface)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().truncate().font_weight(FontWeight::MEDIUM).child(a.label.clone()))
                            .child(div().truncate().text_sm().text_color(p.text_muted).child(status)),
                    )
                    .when(a.is_default, |d| {
                        d.child(
                            div()
                                .px(px(space::X2))
                                .rounded_full()
                                .bg(p.bg_control)
                                .text_xs()
                                .child(t!("accounts.default").into_owned()),
                        )
                    })
                    .child(
                        Button::new(
                            SharedString::from(format!("login-{}", a.id)),
                            if a.logged_in {
                                t!("providers.reconnect")
                            } else {
                                t!("accounts.signIn")
                            }
                            .into_owned(),
                        )
                        .variant(if a.logged_in { Variant::Ghost } else { Variant::Primary })
                        .size(Size::Sm)
                        .on_click(cx.listener(move |this, _, _, cx| this.sign_in(&acct, cx))),
                    )
                    .when(!a.is_default, |d| {
                        d.child(
                            Button::new(
                                SharedString::from(format!("remove-{}", a.id)),
                                t!("common.remove").into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_account(remove.clone(), cx))),
                        )
                    }),
            )
            .children(windows)
            .when(waiting, |d| {
                d.child(
                    div()
                        .text_sm()
                        .text_color(p.text_secondary)
                        .child(t!("accounts.stepPaste").into_owned()),
                )
                .child(
                    div()
                        .flex()
                        .gap(px(space::X2))
                        .child(
                            div()
                                .flex_1()
                                .h(px(crate::theme::tokens::CONTROL_H_SM))
                                .px(px(space::X2_5))
                                .flex()
                                .items_center()
                                .rounded(px(crate::theme::tokens::RADIUS_CONTROL_SM))
                                .border_1()
                                .border_color(p.border)
                                .bg(p.bg_field)
                                .text_sm()
                                .child(div().flex_1().child(Input::new(&code).appearance(false))),
                        )
                        .child(
                            Button::new(
                                SharedString::from(format!("send-code-{}", a.id)),
                                t!("accounts.connect").into_owned(),
                            )
                            .variant(Variant::Primary)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let c = send.read(cx).value().trim().to_string();
                                if !c.is_empty() {
                                    this.send_code(id_send.clone(), c, cx);
                                }
                            })),
                        ),
                )
            })
            .into_any_element()
    }
}
