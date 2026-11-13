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
        let http = self.store.read(cx).http.clone();
        let (path, reload) = (format!("/api/agents/{}", self.id), self.store.downgrade());
        cx.spawn(async move |_, cx| {
            let ok = matches!(
                runtime::spawn(async move { http.patch::<_, Value>(&path, &body).await }).await,
                Ok(Ok(_))
            );
            let _ = reload.update(cx, |s, cx| s.load(cx));
            ok
        })
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

    fn work(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let now = store
            .chats
            .statuses
            .values()
            .find(|s| s.agent_id.as_deref() == Some(&a.id) && !matches!(s.state, ChatStatusState::Idle))
            .cloned();
        let mut sessions: Vec<_> = store
            .chats
            .chats
            .iter()
            .filter(|c| c.agent_ids.contains(&a.id))
            .cloned()
            .collect();
        sessions.sort_by(|x, y| y.last_at.unwrap_or(0.).total_cmp(&x.last_at.unwrap_or(0.)));
        let (when_now, l) = (format::now_ms(), format::lang());
        let now_row: AnyElement = match now {
            Some(s) => {
                let (chat, word, color) = match s.state {
                    ChatStatusState::Running => (s.chat_id.clone(), t!("agent.work.running"), p.text),
                    ChatStatusState::Waiting => (s.chat_id.clone(), t!("agent.work.waiting"), p.warning),
                    _ => (s.chat_id.clone(), t!("agent.work.failed"), p.danger),
                };
                let title = store.chat(&chat).map(crate::labels::chat_title).unwrap_or_default();
                NavRow::new("agent-now", title)
                    .detail(format!("{word} · {}", s.label), Some(color))
                    .emphasis(true)
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(AgentPageEvent::Navigate(Route::Chat { id: chat.clone() }))
                    }))
                    .into_any_element()
            }
            None => div()
                .px(px(space::X3))
                .py(px(space::X2))
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("agent.work.idle").into_owned())
                .into_any_element(),
        };
        let rows: Vec<AnyElement> = sessions
            .iter()
            .take(50)
            .map(|c| {
                let id = c.id.clone();
                NavRow::new(
                    SharedString::from(format!("agent-session-{}", c.id)),
                    crate::labels::chat_title(c),
                )
                .detail(
                    c.last_at.map(|at| format::age(at, when_now, l)).unwrap_or_default(),
                    None,
                )
                .on_click(
                    cx.listener(move |_, _, _, cx| cx.emit(AgentPageEvent::Navigate(Route::Chat { id: id.clone() }))),
                )
                .into_any_element()
            })
            .collect();
        let talk = a.id.clone();
        div()
            .flex()
            .flex_col()
            .gap(px(space::X7))
            .child(
                div().child(
                    Button::new("agent-talk", t!("agent.work.talk", name = a.name).into_owned())
                        .icon(IconName::MessageCircle)
                        .variant(Variant::Primary)
                        .size(Size::Sm)
                        .on_click(cx.listener(move |_, _, _, cx| cx.emit(AgentPageEvent::ChatWith(talk.clone())))),
                ),
            )
            .child(layout::section(
                p,
                t!("agent.work.now").into_owned(),
                Some(t!("agent.work.nowHint").into_owned()),
                None,
                layout::rows(p).child(now_row),
            ))
            .child(layout::section(
                p,
                t!("agent.work.sessions").into_owned(),
                Some(t!("agent.work.sessionsHint").into_owned()),
                None,
                if rows.is_empty() {
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("agent.work.noSessions").into_owned())
                } else {
                    layout::rows(p).children(rows)
                },
            ))
            .into_any_element()
    }

    fn field(label: String, hint: Option<String>, control: AnyElement, p: &tokens::Palette) -> Div {
        div()
            .flex()
            .flex_col()
            .gap(px(space::X1_5))
            .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(label))
            .child(control)
            .when_some(hint, |d, h| d.child(div().text_xs().text_color(p.text_muted).child(h)))
    }

    fn boxed(content: impl IntoElement, p: &tokens::Palette) -> Div {
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

    fn limit_select(&self, a: &Agent, field: &'static str, steps: &[f64], current: Option<f64>) -> Select {
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
            let (http, path, reload) = (
                store.read(cx).http.clone(),
                format!("/api/agents/{id}"),
                store.downgrade(),
            );
            let body = json!({ field: value });
            cx.spawn(async move |cx| {
                let _ = runtime::spawn(async move { http.patch::<_, Value>(&path, &body).await }).await;
                let _ = reload.update(cx, |s, cx| s.load(cx));
            })
            .detach();
        });
        Select::new(
            SharedString::from(format!("agent-{field}")),
            field,
            options,
            current.map(|n| (n as i64).to_string()).unwrap_or_default(),
            pick,
        )
    }

    fn profile(&mut self, a: &Agent, window: &mut Window, _: &mut Context<Self>) -> AnyElement {
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

    fn tools(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
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

    fn memory(&mut self, a: &Agent, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let scope = format!("agent:{}", a.id);
        let mine: Vec<_> = self
            .store
            .read(cx)
            .memories
            .iter()
            .filter(|m| m.scope == scope && matches!(m.state, MemoryState::Active))
            .cloned()
            .collect();
        let row = |m: &crate::net::types::Memory| {
            let (store, id) = (self.store.clone(), m.id.clone());
            div()
                .flex()
                .items_start()
                .gap(px(space::X3))
                .py(px(space::X2))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .when(!m.title.is_empty(), |d| {
                            d.child(div().font_weight(FontWeight::MEDIUM).child(m.title.clone()))
                        })
                        .child(div().text_sm().text_color(p.text_secondary).child(m.text.clone())),
                )
                .child(
                    Button::new(
                        SharedString::from(format!("forget-{}", m.id)),
                        t!("knowledge.forget").into_owned(),
                    )
                    .variant(Variant::Ghost)
                    .size(Size::Xs)
                    .on_click(move |_, _, cx| {
                        // Gone at once; the reload brings it back if the engine refuses.
                        store.update(cx, |s, cx| {
                            s.memories.retain(|x| x.id != id);
                            cx.notify();
                        });
                        let (http, path, reload) = (
                            store.read(cx).http.clone(),
                            format!("/api/memories/{id}"),
                            store.downgrade(),
                        );
                        cx.spawn(async move |cx| {
                            let _ = runtime::spawn(async move {
                                http.patch::<_, Value>(&path, &json!({ "state": "forgotten" })).await
                            })
                            .await;
                            let _ = reload.update(cx, |s, cx| s.load(cx));
                        })
                        .detach();
                    }),
                )
                .into_any_element()
        };
        let facts: Vec<AnyElement> = mine
            .iter()
            .filter(|m| matches!(m.kind, MemoryKind::Fact))
            .map(row)
            .collect();
        let skills: Vec<AnyElement> = mine
            .iter()
            .filter(|m| matches!(m.kind, MemoryKind::Skill))
            .map(row)
            .collect();
        let empty = || {
            div()
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("memory.empty").into_owned())
        };
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(layout::section(
                p,
                t!("agent.mem.notes", name = a.name).into_owned(),
                None,
                None,
                if facts.is_empty() {
                    empty()
                } else {
                    div().flex().flex_col().children(facts)
                },
            ))
            .child(layout::section(
                p,
                t!("agent.skillsTab.title").into_owned(),
                None,
                None,
                if skills.is_empty() {
                    empty()
                } else {
                    div().flex().flex_col().children(skills)
                },
            ))
            .into_any_element()
    }

    fn activity(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let Some(versions) = self.versions.clone() else {
            return div()
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("common.checking").into_owned())
                .into_any_element();
        };
        let (now, l) = (format::now_ms(), format::lang());
        let rows: Vec<AnyElement> = versions
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let who = if v.by == "you" {
                    t!("agent.byYou").into_owned()
                } else {
                    self.store.read(cx).agent_name(Some(&v.by))
                };
                let n = v.n as i64;
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .py(px(space::X2))
                    .child(
                        div()
                            .flex_none()
                            .w(px(32.))
                            .font_family(crate::ui::code::MONO)
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(format!("v{n}")),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_sm()
                            .child(format!("{who} · {}", format::age(v.at, now, l))),
                    )
                    .child(if i == 0 {
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("agent.current").into_owned())
                            .into_any_element()
                    } else {
                        Button::new(
                            SharedString::from(format!("restore-{n}")),
                            t!("agent.restore").into_owned(),
                        )
                        .variant(Variant::Ghost)
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, window, cx| this.ask_restore(n, window, cx)))
                        .into_any_element()
                    })
                    .into_any_element()
            })
            .collect();
        layout::section(
            p,
            t!("agent.history").into_owned(),
            Some(t!("agent.historyHint").into_owned()),
            None,
            div().flex().flex_col().children(rows),
        )
        .into_any_element()
    }

    fn ask_restore(&mut self, n: i64, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, _| {
            let view = view.clone();
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("agent.restoreTitle", n = n).into_owned(),
                    description: Some(t!("agent.restoreBody").into_owned()),
                    body: None,
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("restore", t!("agent.restore").into_owned())
                            .variant(Variant::Primary)
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                let _ = view.update(cx, |this, cx| {
                                    let http = this.store.read(cx).http.clone();
                                    let path = format!("/api/agents/{}/versions/{n}/restore", this.id);
                                    let reload = this.store.downgrade();
                                    cx.spawn_in(window, async move |this, cx| {
                                        let _ =
                                            runtime::spawn(
                                                async move { http.post::<_, Value>(&path, &json!({})).await },
                                            )
                                            .await;
                                        let _ = reload.update(cx, |s, cx| s.load(cx));
                                        let _ = this.update_in(cx, |this, window, cx| {
                                            this.versions = None;
                                            this.load(cx);
                                            this.discard(window, cx);
                                        });
                                    })
                                    .detach();
                                });
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
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
