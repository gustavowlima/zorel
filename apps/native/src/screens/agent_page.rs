// An agent's page (apps/web/src/features/agent.tsx), in tabs: Work (what it does now, Talk with it, its sessions),
// Profile (who it is, its model and token limits, its instructions), Tools and access (files and commands, the web, its
// browser, each connector, what was allowed for good), Memory and skills (what it keeps; Forget), Activity (every
// saved version, any older one restorable). Profile and access edit a draft that one Save (in the head) saves, with
// Discard; the limits and a forgotten memory apply at once. ⋯ archives or deletes it (never the last agent).
// ponytail: the failover list editor and its own computer (container/host, lent folders) come with Settings.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    base::input::{Textarea, TextareaState},
    component::input::{Input, InputState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

mod activity;
mod memory;
mod profile;
mod tools;
mod work;
use serde_json::{Value, json};

use crate::{
    format,
    net::types::{Agent, AgentAccess, AgentVersion, ChatStatusState, McpServer, MemoryKind, MemoryState},
    route::Route,
    runtime,
    screens::{
        agents::Agents,
        model_picker::{ModelChoice, ModelPicker, OnChange},
    },
    state::store::Store,
    theme::{self, tokens},
    ui::{
        button::{Button, Size, Variant},
        face::AgentFace,
        icon::{self, icon},
        layout,
        menu::{self, Menu},
        nav::NavRow,
        segmented::Segmented,
        select::{self, Select, SelectOption},
        space,
    },
};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tab {
    Work,
    Profile,
    Tools,
    Memory,
    Activity,
}

impl Tab {
    const ALL: [Tab; 5] = [Tab::Work, Tab::Profile, Tab::Tools, Tab::Memory, Tab::Activity];

    fn label(self) -> String {
        match self {
            Tab::Work => t!("agent.tabs.work"),
            Tab::Profile => t!("agent.tabs.profile"),
            Tab::Tools => t!("agent.tabs.tools"),
            Tab::Memory => t!("agent.tabs.memory"),
            Tab::Activity => t!("agent.tabs.activity"),
        }
        .into_owned()
    }
}

pub enum AgentPageEvent {
    Navigate(Route),
    ChatWith(String),
}

impl EventEmitter<AgentPageEvent> for AgentPage {}

const ACCESS: [(AgentAccess, &str); 3] = [
    (AgentAccess::Ask, "read"),
    (AgentAccess::Workspace, "write"),
    (AgentAccess::Full, "full"),
];
const MONTHLY: [f64; 5] = [1e6, 5e6, 20e6, 50e6, 100e6];
const PER_REPLY: [f64; 5] = [1e5, 2.5e5, 5e5, 1e6, 2e6];

pub struct AgentPage {
    store: Entity<Store>,
    id: String,
    tab: Tab,
    name: Entity<InputState>,
    title: Entity<InputState>,
    description: Entity<TextareaState>,
    instructions: Entity<TextareaState>,
    model: Entity<ModelPicker>,
    choice: ModelChoice,
    access: AgentAccess,
    permissions: Value,
    busy: bool,
    versions: Option<Vec<AgentVersion>>,
    servers: Option<Vec<McpServer>>,
    _subs: Vec<Subscription>,
}

fn choice_of(a: &Agent) -> ModelChoice {
    ModelChoice {
        model: a.model.clone(),
        account_id: a.account_id.clone(),
        effort: a.effort.map(|e| e.to_string()),
    }
}

impl AgentPage {
    pub fn new(store: Entity<Store>, id: String, tab: Tab, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let agent = store.read(cx).agent(&id).cloned();
        let text = |v: &str, window: &mut Window, cx: &mut Context<Self>| {
            let v = v.to_string();
            cx.new(|cx| {
                let mut s = InputState::new(window, cx);
                s.set_value(v, window, cx);
                s
            })
        };
        let area = |v: &str, rows: (usize, usize), window: &mut Window, cx: &mut Context<Self>| {
            let v = v.to_string();
            cx.new(|cx| {
                let mut s = TextareaState::new(window, cx);
                s.set_auto_grow(rows.0, rows.1, cx);
                s.set_value(v, window, cx);
                s
            })
        };
        let a = agent.clone();
        let name = text(a.as_ref().map_or("", |a| &a.name), window, cx);
        let title = text(a.as_ref().map_or("", |a| &a.title), window, cx);
        let description = area(a.as_ref().map_or("", |a| &a.description), (2, 4), window, cx);
        let instructions = area(a.as_ref().map_or("", |a| &a.instructions), (10, 30), window, cx);
        let view = cx.entity().downgrade();
        let on_change: OnChange = Rc::new(move |choice, _, cx| {
            let _ = view.update(cx, |this, cx| {
                this.choice = choice;
                cx.notify();
            });
        });
        let model = cx.new(|cx| ModelPicker::new(store.clone(), false, on_change, window, cx));
        let choice = a.as_ref().map(choice_of).unwrap_or(ModelChoice {
            model: "claude-cli/sonnet".into(),
            account_id: None,
            effort: None,
        });
        model.update(cx, |m, cx| m.set_value(choice.clone(), cx));
        // Edits redraw (the head's Unsaved and Save follow them).
        let subs = vec![
            cx.observe(&name, |_, _, cx| cx.notify()),
            cx.observe(&title, |_, _, cx| cx.notify()),
            cx.observe(&description, |_, _, cx| cx.notify()),
            cx.observe(&instructions, |_, _, cx| cx.notify()),
            cx.observe(&store, |_, _, cx| cx.notify()),
        ];
        let mut page = Self {
            store,
            id,
            tab,
            name,
            title,
            description,
            instructions,
            model,
            choice,
            access: a.as_ref().map_or(AgentAccess::Workspace, |a| a.access),
            permissions: a
                .as_ref()
                .and_then(|a| serde_json::to_value(&a.permissions).ok())
                .unwrap_or(json!({ "web": true, "browser": true, "grants": {}, "always": [] })),
            busy: false,
            versions: None,
            servers: None,
            _subs: subs,
        };
        page.load(cx);
        page
    }

    fn agent(&self, cx: &App) -> Option<Agent> {
        self.store.read(cx).agent(&self.id).cloned()
    }

    /// Its versions and the connectors in its reach.
    fn load(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        let path = format!("/api/agents/{}/versions", self.id);
        let (h2, this1) = (http.clone(), cx.entity().downgrade());
        cx.spawn(async move |_, cx| {
            if let Ok(Ok(v)) = runtime::spawn(async move { http.get::<Vec<AgentVersion>>(&path).await }).await {
                let _ = this1.update(cx, |this, cx| {
                    this.versions = Some(v);
                    cx.notify();
                });
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(s)) = runtime::spawn(async move { h2.get::<Vec<McpServer>>("/api/mcp").await }).await {
                let _ = this.update(cx, |this, cx| {
                    this.servers = Some(s);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn draft(&self, cx: &App) -> Value {
        json!({
            "name": self.name.read(cx).value().trim(),
            "title": self.title.read(cx).value().trim(),
            "description": self.description.read(cx).value().trim(),
            "instructions": self.instructions.read(cx).value().to_string(),
            "model": self.choice.model,
            "accountId": self.choice.account_id,
            "effort": self.choice.effort,
            "access": self.access.to_string(),
            "permissions": self.permissions,
        })
    }

    fn saved(a: &Agent) -> Value {
        json!({
            "name": a.name, "title": a.title, "description": a.description, "instructions": a.instructions,
            "model": a.model, "accountId": a.account_id, "effort": a.effort.map(|e| e.to_string()),
            "access": a.access.to_string(), "permissions": serde_json::to_value(&a.permissions).unwrap_or_default(),
        })
    }

    fn dirty(&self, cx: &App) -> bool {
        self.agent(cx).is_some_and(|a| Self::saved(&a) != self.draft(cx))
    }

    /// Back to what's saved.
    fn discard(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.agent(cx) else { return };
        self.name.update(cx, |s, cx| s.set_value(a.name.clone(), window, cx));
        self.title.update(cx, |s, cx| s.set_value(a.title.clone(), window, cx));
        self.description
            .update(cx, |s, cx| s.set_value(a.description.clone(), window, cx));
        self.instructions
            .update(cx, |s, cx| s.set_value(a.instructions.clone(), window, cx));
        self.choice = choice_of(&a);
        self.model.update(cx, |m, cx| m.set_value(self.choice.clone(), cx));
        self.access = a.access;
        self.permissions = serde_json::to_value(&a.permissions).unwrap_or_default();
        cx.notify();
    }

    fn patch(&self, body: Value, cx: &mut Context<Self>) -> Task<bool> {
        let written = self.store.update(cx, |s, cx| {
            s.write(
                crate::state::store::Method::Patch,
                format!("/api/agents/{}", self.id),
                body,
                cx,
            )
        });
        cx.spawn(async move |_, _| written.await.is_some())
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let body = self.draft(cx);
        if body["name"].as_str().unwrap_or_default().is_empty() {
            return;
        }
        self.busy = true;
        cx.notify();
        let done = self.patch(body, cx);
        cx.spawn(async move |this, cx| {
            done.await;
            let _ = this.update(cx, |this, cx| {
                this.busy = false;
                this.versions = None;
                this.load(cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn head(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let tone = store.tone(Some(&a.id));
        let subtitle = match a
            .project_id
            .as_deref()
            .and_then(|id| store.projects.iter().find(|p| p.id == id))
        {
            Some(pr) => t!("agent.of", project = pr.name).into_owned(),
            None => t!("agent.globalHint").into_owned(),
        };
        let last = store
            .agents
            .iter()
            .filter(|x| x.builtin.is_none() && x.archived_at.is_none())
            .count()
            <= 1
            && a.archived_at.is_none();
        let dirty = self.dirty(cx);
        let (store_a, store_d, agent_d, archived, id) = (
            self.store.clone(),
            self.store.clone(),
            a.clone(),
            a.archived_at.is_some(),
            a.id.clone(),
        );
        let items: menu::Items = Rc::new(move || {
            let (store_a, store_d, agent_d, id) = (store_a.clone(), store_d.clone(), agent_d.clone(), id.clone());
            if last {
                return Menu::default()
                    .item(t!("agent.lastAgent").into_owned(), |_, _| {})
                    .build();
            }
            Menu::default()
                .item(
                    if archived {
                        t!("agent.restoreArchived")
                    } else {
                        t!("agent.archive")
                    }
                    .into_owned(),
                    move |_, cx| Agents::archive(&store_a, id.clone(), !archived, cx),
                )
                .separator()
                .danger(t!("agent.deleteAction").into_owned(), move |window, cx| {
                    Agents::delete(&store_d, &agent_d, window, cx)
                })
                .build()
        });
        div()
            .flex()
            .items_center()
            .gap(px(space::X3))
            .child(AgentFace::new(SharedString::from(format!("page-face-{}", a.id)), tone).size(40.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .text_size(px(18.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .truncate()
                            .child(a.name.clone()),
                    )
                    .child(div().text_sm().text_color(p.text_muted).child(subtitle)),
            )
            .when(dirty, |d| {
                d.child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("agent.unsaved").into_owned()),
                )
                .child(
                    Button::new("agent-discard", t!("agent.discard").into_owned())
                        .variant(Variant::Ghost)
                        .size(Size::Sm)
                        .on_click(cx.listener(|this, _, window, cx| this.discard(window, cx))),
                )
            })
            .child(menu::dropdown(
                "agent-page-more",
                Button::icon_only(
                    "agent-page-more-btn",
                    IconName::Ellipsis,
                    t!("common.more").into_owned(),
                )
                .size(Size::Sm),
                items,
            ))
            .child(
                Button::new("agent-save", t!("common.save").into_owned())
                    .variant(Variant::Primary)
                    .size(Size::Sm)
                    .disabled(!dirty || self.busy)
                    .on_click(cx.listener(|this, _, _, cx| this.save(cx))),
            )
            .into_any_element()
    }
}

impl Render for AgentPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl AgentPage {
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let Some(a) = self.agent(cx) else {
            return div()
                .p(px(space::X6))
                .text_color(p.text_muted)
                .child(t!("agents.empty").into_owned())
                .into_any_element();
        };
        let head = self.head(&a, window, cx);
        let current = self.tab;
        let tabs: Vec<AnyElement> = Tab::ALL
            .iter()
            .map(|&tab| {
                let selected = tab == current;
                div()
                    .id(SharedString::from(format!("agent-tab-{tab:?}")))
                    .px(px(space::X3))
                    .py(px(space::X2))
                    .text_sm()
                    .border_b_2()
                    .map(|d| {
                        if selected {
                            d.border_color(p.accent).text_color(p.text)
                        } else {
                            d.border_color(gpui_kit::transparent_black()).text_color(p.text_muted)
                        }
                    })
                    .hover(|s| s.text_color(p.text))
                    .child(tab.label())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.tab = tab;
                        cx.notify();
                    }))
                    .into_any_element()
            })
            .collect();
        let body = match self.tab {
            Tab::Work => self.work(&a, window, cx),
            Tab::Profile => self.profile(&a, window, cx),
            Tab::Tools => self.tools(&a, window, cx),
            Tab::Memory => self.memory(&a, window, cx),
            Tab::Activity => self.activity(window, cx),
        };
        div()
            .id("agent-page")
            .size_full()
            .overflow_y_scroll()
            .child(
                div()
                    .w_full()
                    .max_w(px(760.))
                    .mx_auto()
                    .px(px(space::X6))
                    .py(px(space::X6))
                    .flex()
                    .flex_col()
                    .gap(px(space::X6))
                    .child(head)
                    .when(a.archived_at.is_some(), |d| {
                        d.child(
                            layout::card(p)
                                .p(px(space::X4))
                                .flex()
                                .flex_col()
                                .gap(px(space::X1))
                                .child(
                                    div()
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(t!("agent.archivedTitle").into_owned()),
                                )
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(p.text_muted)
                                        .child(t!("agent.archivedBody").into_owned()),
                                ),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .gap(px(space::X1))
                            .border_b_1()
                            .border_color(p.border)
                            .children(tabs),
                    )
                    .child(body),
            )
            .into_any_element()
    }
}
