// Settings › Accounts (apps/web/src/features/providers.tsx, the prototype's "Accounts" and "Usage"): subscriptions in
// the order Zorel uses them, each a row with who is signed in, the window closest to its limit as a bar with how much
// is used and when it resets, Sign in / Reconnect (the provider's login page; a pasted code when it shows one) and
// Remove (never the default), Add account per provider; then the API keys (system keychain; add, replace, remove;
// where to get one); then the local servers and agent CLIs and whether they answer. Zorel never reads a CLI's login.
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
    /// The API key being added or replaced.
    editing_key: Option<&'static str>,
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
        let (accounts, models) = {
            let store = self.store.read(cx);
            (store.accounts.clone(), store.models.clone())
        };
        let keys = self.providers.keys.clone().unwrap_or_default();
        // Subscriptions, in the order Zorel uses them (the default first).
        let mut subs: Vec<ProviderAccount> = accounts
            .iter()
            .filter(|a| matches!(a.kind, ProviderAccountKind::Subscription))
            .cloned()
            .collect();
        subs.sort_by_key(|a| !a.is_default);
        let sub_rows: Vec<AnyElement> = subs.iter().map(|a| self.account_row(a, window, cx)).collect();
        let add_items: crate::ui::menu::Items = {
            let view = cx.entity().downgrade();
            Rc::new(move || {
                let mut m = crate::ui::menu::Menu::default();
                for pr in PROVIDERS.iter().filter(|p| p.account.is_some()) {
                    let (view, provider) = (view.clone(), pr.account.unwrap_or_default());
                    let name = t!(format!("providers.names.{}", pr.id)).into_owned();
                    let label = t!("settings.addAccountFor", name = name).into_owned();
                    m = m.item(label, move |_, cx| {
                        let name = name.clone();
                        let _ = view.update(cx, |this, cx| this.add_account(provider, name, cx));
                    });
                }
                m.build()
            })
        };
        // API keys: one row per provider that takes one.
        let key_rows: Vec<AnyElement> = PROVIDERS
            .iter()
            .filter_map(|pr| pr.key.map(|k| (pr, k)))
            .map(|(pr, k)| self.key_row(pr, k, keys.iter().find(|x| x.name == k).cloned(), window, cx))
            .collect();
        // Local servers and agent CLIs: whether they answer.
        let local_rows: Vec<AnyElement> = PROVIDERS
            .iter()
            .filter(|pr| pr.account.is_none() && pr.key.is_none())
            .map(|pr| {
                let available = models
                    .iter()
                    .filter(|m| pr.harnesses.iter().any(|h| m.id.starts_with(&format!("{h}/"))) && m.available)
                    .count();
                let name = t!(format!("providers.names.{}", pr.id)).into_owned();
                let (state, color) = if available > 0 {
                    (t!("providers.running"), p.success)
                } else {
                    (t!("providers.notRunning"), p.text_muted)
                };
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .py(px(space::X3))
                    .border_b_1()
                    .border_color(p.border)
                    .child(crate::screens::model_picker::mark(pr.mark, 18., p.text))
                    .child(div().flex_1().font_weight(FontWeight::MEDIUM).child(name))
                    .child(div().text_sm().text_color(color).child(state.into_owned()))
                    .when(available > 0, |d| {
                        d.child(
                            div()
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(format!("· {available} {}", t!("providers.models").to_lowercase())),
                        )
                    })
                    .into_any_element()
            })
            .collect();
        let head = |title: String| div().text_sm().text_color(p.text_muted).pb(px(space::X1)).child(title);
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("accounts.intro").into_owned()),
            )
            .when_some(self.providers.error.clone(), |d, e| {
                d.child(div().text_sm().text_color(p.danger).child(e))
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex()
                            .items_end()
                            .gap(px(space::X2))
                            .child(div().flex_1().child(head(t!("settings.subscriptions").into_owned())))
                            .child(crate::ui::menu::dropdown(
                                "accounts-add",
                                Button::new("accounts-add-btn", t!("accounts.add").into_owned())
                                    .icon(IconName::Plus)
                                    .variant(Variant::Secondary)
                                    .size(Size::Sm),
                                add_items,
                            )),
                    )
                    .children(sub_rows),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(head(t!("settings.keys").into_owned()))
                    .children(key_rows),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(head(t!("settings.local").into_owned()))
                    .children(local_rows),
            )
            .into_any_element()
    }

    /// One API key: whose, whether it's saved, and a field to add or replace it (or remove it).
    fn key_row(
        &mut self,
        pr: &'static Provider,
        k: &'static str,
        key: Option<KeyInfo>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let name = t!(format!("providers.names.{}", pr.id)).into_owned();
        let set = key.as_ref().is_some_and(|x| x.set);
        let from_env = key.as_ref().is_some_and(|x| x.from_env);
        let field = window.use_keyed_state(SharedString::from(format!("key-{k}")), cx, |window, cx| {
            InputState::new(window, cx)
                .masked(true)
                .placeholder(t!("providers.pasteKey", name = name).into_owned())
        });
        let editing = self.providers.editing_key == Some(k);
        let save = field.clone();
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
                    .child(crate::screens::model_picker::mark(pr.mark, 18., p.text))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().font_weight(FontWeight::MEDIUM).child(name.clone()))
                            .child(div().text_sm().text_color(p.text_muted).child(k)),
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
                    .when(!editing, |d| {
                        d.child(
                            Button::new(
                                SharedString::from(format!("key-edit-{k}")),
                                if set {
                                    t!("providers.replaceKey")
                                } else {
                                    t!("providers.addKey")
                                }
                                .into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.providers.editing_key = Some(k);
                                cx.notify();
                            })),
                        )
                    })
                    .when(set && !from_env, |d| {
                        d.child(
                            Button::new(
                                SharedString::from(format!("key-clear-{k}")),
                                t!("common.remove").into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, _, cx| this.set_key(k, String::new(), cx))),
                        )
                    }),
            )
            .when(editing, |d| {
                d.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X2))
                        .pl(px(30.))
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
                                .child(div().flex_1().child(Input::new(&field).appearance(false))),
                        )
                        .when_some(pr.key_url, |d, url| {
                            d.child(
                                Button::new(
                                    SharedString::from(format!("get-key-{k}")),
                                    t!("providers.getKey").into_owned(),
                                )
                                .icon(IconName::ExternalLink)
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(move |_, _, cx| cx.open_url(url)),
                            )
                        })
                        .child(
                            Button::new(
                                SharedString::from(format!("key-cancel-{k}")),
                                t!("common.cancel").into_owned(),
                            )
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.providers.editing_key = None;
                                cx.notify();
                            })),
                        )
                        .child(
                            Button::new(
                                SharedString::from(format!("key-save-{k}")),
                                t!("common.save").into_owned(),
                            )
                            .variant(Variant::Primary)
                            .size(Size::Sm)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let v = save.read(cx).value().trim().to_string();
                                if !v.is_empty() {
                                    this.set_key(k, v, cx);
                                    this.providers.editing_key = None;
                                    save.update(cx, |s, cx| s.set_value(String::new(), window, cx));
                                }
                            })),
                        ),
                )
            })
            .into_any_element()
    }

    /// A subscription: its name and who it is, the window closest to its limit as a bar, how much is used and when
    /// it resets; Sign in / Reconnect, Remove (never the default); a pasted code when the login waits for one.
    fn account_row(&mut self, a: &ProviderAccount, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let waiting = self.providers.waiting.contains(&a.id);
        let who = if waiting {
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
        let provider = PROVIDERS.iter().find(|x| x.account == Some(a.provider.as_str()));
        let now = format::now_ms();
        // The window closest to its limit.
        let worst = a.usage.as_ref().and_then(|u| {
            u.windows
                .iter()
                .max_by(|x, y| {
                    x.used_percent
                        .partial_cmp(&y.used_percent)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .cloned()
        });
        let meter = worst.map(|w| {
            let pace = pace_of(&w.id, w.used_percent, w.resets_at, now);
            let tone = tone_of(&pace);
            let color = match tone {
                crate::labels::Tone::Critical => p.danger,
                crate::labels::Tone::Warning => p.warning,
                _ => p.accent,
            };
            let reset = w
                .resets_at
                .map(|at| format::duration((at - now).max(0.), format::lang()))
                .unwrap_or_else(|| window_label(&w.id));
            (w.used_percent, color, reset, tone != crate::labels::Tone::Ok)
        });
        let (acct, remove) = (a.clone(), a.id.clone());
        let code = window.use_keyed_state(SharedString::from(format!("code-{}", a.id)), cx, |window, cx| {
            InputState::new(window, cx).placeholder(t!("accounts.codePlaceholder").into_owned())
        });
        let (send, id_send) = (code.clone(), a.id.clone());
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
                    .gap(px(space::X4))
                    .children(provider.map(|pr| crate::screens::model_picker::mark(pr.mark, 18., p.text)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(space::X2))
                                    .child(div().truncate().font_weight(FontWeight::MEDIUM).child(a.label.clone()))
                                    .when(a.is_default, |d| {
                                        d.child(
                                            div()
                                                .px(px(space::X1_5))
                                                .rounded_full()
                                                .bg(p.bg_control)
                                                .text_xs()
                                                .text_color(p.text_muted)
                                                .child(t!("accounts.default").into_owned()),
                                        )
                                    }),
                            )
                            .child(div().truncate().text_sm().text_color(p.text_muted).child(who)),
                    )
                    .child(
                        div()
                            .flex_none()
                            .w(px(180.))
                            .h(px(6.))
                            .rounded_full()
                            .bg(p.bg_control)
                            .overflow_hidden()
                            .children(meter.as_ref().map(|(used, color, _, _)| {
                                div()
                                    .h_full()
                                    .rounded_full()
                                    .bg(*color)
                                    .w(relative((used / 100.).clamp(0., 1.) as f32))
                            })),
                    )
                    .child(
                        div()
                            .flex_none()
                            .w(px(120.))
                            .text_right()
                            .text_sm()
                            .text_color(p.text_muted)
                            .children(meter.map(|(used, color, reset, alert)| {
                                div().child(
                                    div()
                                        .flex()
                                        .justify_end()
                                        .gap(px(space::X1))
                                        .child(
                                            div()
                                                .text_color(if alert { color } else { p.text_muted })
                                                .child(format::percent(used / 100.)),
                                        )
                                        .child(format!("· {reset}")),
                                )
                            })),
                    )
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
                            Button::icon_only(
                                SharedString::from(format!("remove-{}", a.id)),
                                IconName::X,
                                t!("accounts.removeTitle", name = a.label).into_owned(),
                            )
                            .size(Size::Xs)
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_account(remove.clone(), cx))),
                        )
                    }),
            )
            .when(waiting, |d| {
                d.child(
                    div()
                        .pl(px(34.))
                        .text_sm()
                        .text_color(p.text_secondary)
                        .child(t!("accounts.stepPaste").into_owned()),
                )
                .child(
                    div()
                        .flex()
                        .gap(px(space::X2))
                        .pl(px(34.))
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
