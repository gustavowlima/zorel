// The model picker (apps/web/src/features/model-picker.tsx, prototype "Choose model"): the composer's model as a
// quiet button (the provider's mark, the model's name, the account when there are several); it opens a float with a
// rail of accounts and providers, the selected one's models (or a search across all of them), a field for any model
// id on API providers, and, for engines that reason, the level as a segmented choice. Picking closes it.
// ponytail: each account's limits (web LimitWindows) and "Set up" open Settings › Providers once that screen exists;
// until then the sidebar's usage popover shows the limits.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::{
        input::{Input, InputEvent, InputState},
        popover::{Popover, PopoverState},
    },
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    assets::provider_mark,
    labels::{model_name, provider_label, split_model},
    net::types::{Agent, ModelInfo, ModelInfoKind, ProviderAccount},
    state::store::Store,
    theme::{self, tokens},
    ui::{
        button::{Button, Size, Variant},
        dialog::field,
        icon::{self, icon},
        layout, motion,
        segmented::{self, Segmented},
        space,
    },
};

pub const DEFAULT_MODEL: &str = "claude-cli/sonnet";

#[derive(Clone, Debug, PartialEq)]
pub struct ModelChoice {
    pub model: String,
    pub account_id: Option<String>,
    pub effort: Option<String>,
}

impl Default for ModelChoice {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            account_id: None,
            effort: None,
        }
    }
}

impl ModelChoice {
    /// An agent's own model, account and level.
    pub fn of(agent: &Agent) -> Self {
        Self {
            model: agent.model.clone(),
            account_id: agent.account_id.clone(),
            effort: agent.effort.map(|e| e.to_string()),
        }
    }
}

pub type OnChange = Rc<dyn Fn(ModelChoice, &mut Window, &mut App) + 'static>;

const EFFORT_PROVIDERS: [&str; 2] = ["claude-cli", "codex-cli"];
const EFFORTS: [&str; 5] = ["default", "low", "medium", "high", "max"];
const LOCAL: [&str; 2] = ["ollama", "lmstudio"];
const ACP: [&str; 3] = ["gemini-cli", "opencode", "antigravity"];

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Subscription,
    Api,
    Local,
    Agent,
}

/// One button on the rail: a subscription account, an API provider, a local server or an agent CLI.
#[derive(Clone, Debug)]
struct Entry {
    key: String,
    provider: String,
    label: String,
    kind: Kind,
    account: Option<ProviderAccount>,
    /// The account's initial when a provider has several.
    badge: Option<String>,
    available: bool,
    models: Vec<String>,
}

/// The rail, in the web's order: Claude and Codex accounts, then API providers (a twin of a subscription only when it
/// has a key; a local server only while running), then the agent CLIs that are installed.
fn entries(accounts: &[ProviderAccount], models: &[ModelInfo]) -> Vec<Entry> {
    let names_of = |provider: &str| -> Vec<String> {
        models
            .iter()
            .filter(|m| m.provider == provider && !m.id.ends_with('…'))
            .map(|m| split_model(&m.id).1.to_string())
            .collect()
    };
    let available = |provider: &str| models.iter().any(|m| m.provider == provider && m.available);
    let mut out = Vec::new();
    for (provider, account_provider) in [("claude-cli", "claude"), ("codex-cli", "codex")] {
        let mine: Vec<&ProviderAccount> = accounts.iter().filter(|a| a.provider == account_provider).collect();
        let info = models.iter().any(|m| m.provider == provider);
        if mine.is_empty() && !info {
            continue;
        }
        if mine.is_empty() {
            out.push(Entry {
                key: provider.into(),
                provider: provider.into(),
                label: provider_label(provider),
                kind: Kind::Subscription,
                account: None,
                badge: None,
                available: available(provider),
                models: names_of(provider),
            });
            continue;
        }
        for a in &mine {
            out.push(Entry {
                key: a.id.clone(),
                provider: provider.into(),
                label: a.label.clone(),
                kind: Kind::Subscription,
                account: Some((*a).clone()),
                badge: (mine.len() > 1).then(|| a.label.trim().chars().take(1).collect::<String>().to_uppercase()),
                available: a.logged_in && a.limited_until.is_none(),
                models: names_of(provider),
            });
        }
    }
    let mut apis: Vec<&str> = Vec::new();
    for m in models.iter().filter(|m| matches!(m.kind, ModelInfoKind::Api)) {
        if !apis.contains(&m.provider.as_str()) {
            apis.push(&m.provider);
        }
    }
    for provider in apis {
        let up = available(provider);
        let twin = match provider {
            "anthropic" => Some("claude-cli"),
            "openai" => Some("codex-cli"),
            _ => None,
        };
        if !up && twin.is_some_and(|t| out.iter().any(|e| e.provider == t)) {
            continue;
        }
        if !up && LOCAL.contains(&provider) {
            continue;
        }
        out.push(Entry {
            key: provider.into(),
            provider: provider.into(),
            label: provider_label(provider),
            kind: if LOCAL.contains(&provider) {
                Kind::Local
            } else {
                Kind::Api
            },
            account: None,
            badge: None,
            available: up,
            models: names_of(provider),
        });
    }
    for provider in ACP.into_iter().filter(|p| available(p)) {
        out.push(Entry {
            key: provider.into(),
            provider: provider.into(),
            label: provider_label(provider),
            kind: Kind::Agent,
            account: None,
            badge: None,
            available: true,
            models: names_of(provider),
        });
    }
    out
}

/// The entry a choice belongs to: its account, else the provider's default account, else the provider.
fn entry_of(entries: &[Entry], v: &ModelChoice) -> Option<usize> {
    let provider = split_model(&v.model).0;
    let mine = |e: &&Entry| e.provider == provider;
    entries
        .iter()
        .position(|e| mine(&e) && e.account.as_ref().is_some_and(|a| Some(&a.id) == v.account_id.as_ref()))
        .or_else(|| {
            entries
                .iter()
                .position(|e| mine(&e) && e.account.as_ref().is_some_and(|a| a.is_default))
        })
        .or_else(|| entries.iter().position(|e| mine(&e)))
}

/// A model's line under its name: what the engine says, else the known families' notes.
fn note_of(id: &str, models: &[ModelInfo]) -> Option<String> {
    if let Some(note) = models.iter().find(|m| m.id == id).and_then(|m| m.note.clone()) {
        return Some(note);
    }
    let family = split_model(id).1;
    ["opus", "sonnet", "haiku", "default"]
        .contains(&family)
        .then(|| t!(format!("model.notes.{family}")).into_owned())
}

/// A model id anyone can type (`provider/model`).
fn valid_id(s: &str) -> bool {
    match s.split_once('/') {
        Some((p, m)) => {
            !p.is_empty()
                && p.chars().all(|c| c.is_ascii_lowercase() || c == '-')
                && !m.is_empty()
                && !m.contains(char::is_whitespace)
        }
        None => false,
    }
}

pub struct ModelPicker {
    store: Entity<Store>,
    value: ModelChoice,
    /// The rail's selection (an entry key); None: the current choice's.
    rail: Option<String>,
    query: Entity<InputState>,
    custom: Entity<InputState>,
    on_change: OnChange,
    /// The entry the current choice belongs to (set when the list renders).
    current_key: Option<String>,
    /// Below the trigger (Home's box near the top) or above it (a chat's box at the bottom).
    above: bool,
    _subscriptions: Vec<Subscription>,
}

impl ModelPicker {
    pub fn new(
        store: Entity<Store>,
        above: bool,
        on_change: OnChange,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let query = cx.new(|cx| InputState::new(window, cx).placeholder(t!("model.search").into_owned()));
        let custom = cx.new(|cx| InputState::new(window, cx).placeholder(t!("model.customId").into_owned()));
        let subscriptions = vec![
            cx.subscribe(&query, |_, _, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
            cx.observe(&store, |_, _, cx| cx.notify()),
        ];
        Self {
            store,
            value: ModelChoice::default(),
            rail: None,
            query,
            custom,
            on_change,
            above,
            current_key: None,
            _subscriptions: subscriptions,
        }
    }

    /// The choice shown (the owner's: Home's lead or pick, a chat's model).
    pub fn set_value(&mut self, value: ModelChoice, cx: &mut Context<Self>) {
        if self.value != value {
            self.value = value;
            cx.notify();
        }
    }

    fn change(
        &mut self,
        choice: ModelChoice,
        popover: &Entity<PopoverState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.value = choice.clone();
        self.rail = None;
        self.query.update(cx, |q, cx| q.set_value("", window, cx));
        popover.update(cx, |s, cx| s.dismiss(window, cx));
        (self.on_change)(choice, window, cx);
        cx.notify();
    }

    fn pick(
        &mut self,
        entry: &Entry,
        model: &str,
        popover: &Entity<PopoverState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let choice = ModelChoice {
            model: format!("{}/{model}", entry.provider),
            account_id: entry.account.as_ref().filter(|a| !a.is_default).map(|a| a.id.clone()),
            effort: EFFORT_PROVIDERS
                .contains(&entry.provider.as_str())
                .then(|| self.value.effort.clone())
                .flatten(),
        };
        self.change(choice, popover, window, cx);
    }

    fn body(&mut self, popover: Entity<PopoverState>, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let (accounts, models) = {
            let store = self.store.read(cx);
            (store.accounts.clone(), store.models.clone())
        };
        let entries = entries(&accounts, &models);
        let current = entry_of(&entries, &self.value);
        self.current_key = current.and_then(|ix| entries.get(ix)).map(|e| e.key.clone());
        let rail_ix = self
            .rail
            .as_ref()
            .and_then(|k| entries.iter().position(|e| &e.key == k))
            .or(current)
            .unwrap_or(0);
        let q = self.query.read(cx).value().trim().to_lowercase();
        let searching = !q.is_empty();

        let rail: Vec<AnyElement> = entries
            .iter()
            .enumerate()
            .map(|(i, e)| {
                let selected = !searching && i == rail_ix;
                let key = e.key.clone();
                let id = ElementId::from(format!("model-rail-{}", e.key));
                let pointer = motion::pointer(&id, window, cx);
                let lit = selected || pointer.read(cx).hovered;
                let bg = motion::color(
                    &id,
                    "bg",
                    if selected {
                        p.bg_control_active
                    } else if lit {
                        p.bg_hover
                    } else {
                        Rgba { a: 0., ..p.bg_hover }
                    },
                    window,
                    cx,
                );
                let button = div()
                    .id(id.clone())
                    .role(Role::Tab)
                    .aria_label(e.label.clone())
                    .aria_selected(selected)
                    .relative()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(tokens::CONTROL_H_LG))
                    .rounded(px(tokens::RADIUS_CONTROL))
                    .bg(bg)
                    .text_color(if lit { p.text } else { p.text_secondary })
                    .when(!e.available, |b| b.opacity(0.45))
                    .child(mark(&e.provider, 20., if lit { p.text } else { p.text_secondary }))
                    .when_some(e.badge.clone(), |b, badge| {
                        b.child(
                            div()
                                .absolute()
                                .bottom(px(2.))
                                .right(px(2.))
                                .size(px(14.))
                                .rounded_full()
                                .bg(p.bg_raised)
                                .border_1()
                                .border_color(p.border_strong)
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(9.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(badge),
                        )
                    })
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.rail = Some(key.clone());
                        this.query.update(cx, |q, cx| q.set_value("", window, cx));
                        cx.notify();
                    }));
                motion::track(button, &pointer).into_any_element()
            })
            .collect();

        let pane: AnyElement = if searching {
            let mut rows: Vec<AnyElement> = Vec::new();
            for e in &entries {
                for m in e
                    .models
                    .iter()
                    .filter(|m| format!("{} {m}", e.label).to_lowercase().contains(&q))
                {
                    rows.push(self.option(e, m, Some(e.label.clone()), &popover, &models, window, cx));
                }
            }
            let typed = self.query.read(cx).value().trim().to_string();
            if valid_id(&typed) {
                let pop = popover.clone();
                let choice = ModelChoice {
                    model: typed.clone(),
                    account_id: None,
                    effort: None,
                };
                rows.push(
                    option_row(
                        "model-custom",
                        typed,
                        Some(t!("model.customHint").into_owned()),
                        false,
                        window,
                        cx,
                    )
                    .on_click(cx.listener(move |this, _, window, cx| this.change(choice.clone(), &pop, window, cx)))
                    .into_any_element(),
                );
            }
            if rows.is_empty() {
                rows.push(
                    div()
                        .px(px(space::X2_5))
                        .py(px(space::X3))
                        .text_color(p.text_muted)
                        .child(t!("model.noMatch").into_owned())
                        .into_any_element(),
                );
            }
            list(rows)
        } else if let Some(e) = entries.get(rail_ix).cloned() {
            self.pane(&e, &popover, &models, window, cx)
        } else {
            list(Vec::new())
        };

        let effort = EFFORT_PROVIDERS.contains(&split_model(&self.value.model).0).then(|| {
            let level = self.value.effort.clone().unwrap_or_else(|| "default".into());
            let selected = EFFORTS.iter().position(|e| *e == level).unwrap_or(0);
            let view = cx.entity().downgrade();
            let pick: segmented::OnPick = Rc::new(move |ix, window, cx| {
                let _ = view.update(cx, |this, cx| {
                    let mut choice = this.value.clone();
                    choice.effort = (ix > 0).then(|| EFFORTS[ix].to_string());
                    this.value = choice.clone();
                    (this.on_change)(choice, window, cx);
                    cx.notify();
                });
            });
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .gap(px(space::X3))
                .px(px(space::X3))
                .py(px(space::X2_5))
                .border_t_1()
                .border_color(p.border)
                .child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("model.effort").into_owned()),
                )
                .child(Segmented::new(
                    "model-effort",
                    t!("model.effort").into_owned(),
                    EFFORTS
                        .iter()
                        .map(|e| t!(format!("model.effortLevel.{e}")).into_owned().into())
                        .collect(),
                    selected,
                    pick,
                ))
        });

        layout::panel("model-picker-panel", p)
            .p_0()
            .w(px(448.))
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .h(px(400.))
                    .child(
                        div()
                            .id("model-rail")
                            .flex()
                            .flex_col()
                            .flex_none()
                            .items_center()
                            .gap(px(space::X1_5))
                            .w(px(60.))
                            .py(px(space::X2_5))
                            .border_r_1()
                            .border_color(p.border)
                            .overflow_y_scroll()
                            .role(Role::TabList)
                            .aria_label(t!("model.accounts").into_owned())
                            .children(rail)
                            .child(div().flex_1())
                            // ponytail: opens Settings › Providers once that screen exists.
                            .child(
                                Button::icon_only(
                                    "model-settings",
                                    IconName::Settings,
                                    t!("settings.providers").into_owned(),
                                )
                                .size(Size::Md)
                                .disabled(true),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(space::X2))
                            .p(px(space::X2_5))
                            .child(field(window, Input::new(&self.query).appearance(false)))
                            .child(pane),
                    ),
            )
            .children(effort)
            .into_any_element()
    }

    /// The selected entry: who it is, whether it works, its models, and a field for any id on an API provider.
    fn pane(
        &mut self,
        e: &Entry,
        popover: &Entity<PopoverState>,
        models: &[ModelInfo],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let kind = match e.kind {
            Kind::Subscription => e
                .account
                .as_ref()
                .and_then(|a| a.identity.clone())
                .unwrap_or_else(|| t!("model.subscription").into_owned()),
            Kind::Local => t!("model.local").into_owned(),
            Kind::Agent => t!("model.agentCli").into_owned(),
            Kind::Api => t!("model.apiKey").into_owned(),
        };
        let limited = e.account.as_ref().is_some_and(|a| a.limited_until.is_some());
        let rows: Vec<AnyElement> = if e.available || limited {
            e.models
                .clone()
                .iter()
                .map(|m| self.option(e, m, None, popover, models, window, cx))
                .collect()
        } else {
            Vec::new()
        };
        let custom = (e.available && e.kind != Kind::Subscription).then(|| {
            let (entry, pop) = (e.clone(), popover.clone());
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(space::X1_5))
                .child(
                    div()
                        .flex_1()
                        .child(field(window, Input::new(&self.custom).appearance(false))),
                )
                .child(
                    Button::new("model-use", t!("model.use").into_owned())
                        .size(Size::Sm)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            let id = this.custom.read(cx).value().trim().to_string();
                            if !id.is_empty() {
                                this.custom.update(cx, |c, cx| c.set_value("", window, cx));
                                this.pick(&entry, &id, &pop, window, cx);
                            }
                        })),
                )
        });
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .gap(px(space::X1_5))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .px(px(space::X2_5))
                    .pt(px(space::X1))
                    .child(mark(&e.provider, icon::SM, p.text))
                    .child(
                        div()
                            .truncate()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(e.label.clone()),
                    )
                    .child(div().truncate().text_sm().text_color(p.text_muted).child(kind)),
            )
            // Not set up (signed out, no key, server off): it says so; the setup lives in Settings › Providers.
            .when(!e.available && !limited, |c| {
                let signed_out = e.kind == Kind::Subscription;
                c.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X2))
                        .px(px(space::X2_5))
                        .py(px(space::X1))
                        .text_sm()
                        .child(
                            div().flex_1().text_color(p.text_muted).child(
                                t!(if signed_out {
                                    "model.signedOut"
                                } else {
                                    "model.unavailable"
                                })
                                .into_owned(),
                            ),
                        )
                        .child(
                            Button::new(
                                "model-setup",
                                t!(if signed_out { "model.signIn" } else { "model.setUp" }).into_owned(),
                            )
                            .size(Size::Sm)
                            .disabled(true),
                        ),
                )
            })
            .child(list(rows))
            .children(custom)
            .into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn option(
        &mut self,
        e: &Entry,
        model: &str,
        note: Option<String>,
        popover: &Entity<PopoverState>,
        models: &[ModelInfo],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = format!("{}/{model}", e.provider);
        let selected = self.value.model == id && self.current_key.as_deref() == Some(e.key.as_str());
        let note = note.or_else(|| note_of(&id, models));
        let (entry, model, pop) = (e.clone(), model.to_string(), popover.clone());
        option_row(
            &format!("model-option-{}-{model}", e.key),
            model_name(&id, models),
            note,
            selected,
            window,
            cx,
        )
        .on_click(cx.listener(move |this, _, window, cx| this.pick(&entry, &model, &pop, window, cx)))
        .into_any_element()
    }
}

impl Render for ModelPicker {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl ModelPicker {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let (accounts, models) = {
            let store = self.store.read(cx);
            (store.accounts.clone(), store.models.clone())
        };
        let (provider, _) = split_model(&self.value.model);
        let all = entries(&accounts, &models);
        let several = all.iter().filter(|e| e.provider == provider).count() > 1;
        let account = several
            .then(|| {
                entry_of(&all, &self.value)
                    .and_then(|ix| all.get(ix))
                    .map(|e| e.label.clone())
            })
            .flatten();
        let label = match account {
            Some(a) => format!("{} · {a}", model_name(&self.value.model, &models)),
            None => model_name(&self.value.model, &models),
        };
        let trigger = Button::new("model-trigger", label)
            .variant(Variant::Ghost)
            .size(Size::Sm)
            .leading(mark(provider, icon::SM, p.text_secondary))
            .name(t!("model.choose").into_owned());
        let picker = cx.entity();
        Popover::new("model-picker")
            .anchor(if self.above {
                Anchor::BottomRight
            } else {
                Anchor::TopRight
            })
            .offset(px(space::X1_5))
            .appearance(false)
            .trigger(trigger)
            .content(move |_, window, cx| {
                let popover = cx.entity();
                picker.update(cx, |p, cx| p.body(popover, window, cx))
            })
    }
}

/// A provider's mark, or a neutral box for one without.
pub(crate) fn mark(provider: &str, size: f32, color: Rgba) -> AnyElement {
    match provider_mark(provider) {
        Some(path) => svg()
            .path(path)
            .size(px(size))
            .flex_none()
            .text_color(color)
            .into_any_element(),
        None => icon(IconName::Box, size).text_color(color).into_any_element(),
    }
}

fn list(rows: Vec<AnyElement>) -> AnyElement {
    div()
        .id("model-list")
        .flex()
        .flex_col()
        .flex_1()
        .min_h_0()
        .gap(px(space::X0_5))
        .overflow_y_scroll()
        .children(rows)
        .into_any_element()
}

/// A model's row: name, its note under it, a check when chosen; the accent wash eases in on hover.
fn option_row(
    key: &str,
    title: String,
    note: Option<String>,
    selected: bool,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    let p = theme::palette(window);
    let id = ElementId::from(key.to_string());
    let pointer = motion::pointer(&id, window, cx);
    let hovered = pointer.read(cx).hovered;
    let bg = motion::color(
        &id,
        "bg",
        if hovered {
            p.bg_control
        } else {
            motion::fade(p.bg_control, 0.)
        },
        window,
        cx,
    );
    let row = div()
        .id(id)
        .role(Role::ListBoxOption)
        .aria_selected(selected)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(space::X2))
        .min_h(px(tokens::CONTROL_H))
        .px(px(space::X2_5))
        .py(px(space::X1_5))
        .rounded(px(tokens::RADIUS_ROW))
        .bg(bg)
        .text_color(if hovered || selected { p.text } else { p.text_secondary })
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .child(div().truncate().child(title))
                .when_some(note, |c, n| {
                    c.child(div().truncate().text_sm().text_color(p.text_muted).child(n))
                }),
        )
        .when(selected, |r| {
            r.child(icon(IconName::Check, icon::MD).text_color(p.accent_text))
        });
    motion::track(row, &pointer)
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn any_provider_slash_model_is_an_id() {
        assert!(valid_id("openrouter/meta/llama-4"));
        assert!(valid_id("anthropic/claude-x"));
        assert!(!valid_id("llama"));
        assert!(!valid_id("Open/x"));
        assert!(!valid_id("openrouter/has space"));
    }
}
