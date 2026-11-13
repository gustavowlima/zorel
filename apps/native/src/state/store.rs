// What every screen reads (spec 019): agents, projects, chats with their live statuses, routines — loaded once over
// REST when the engine is up, kept current by the status stream (a chat it doesn't know makes it refetch the list).
// Screens hold an `Entity<Store>` and observe it; mutations go through its `http`/`rpc` and the stream brings the
// result back. Mirrors the web's shared atoms (apps/web/src/client.ts).
use gpui_kit::*;
use serde_json::Value;

use crate::{
    net::{
        http::{Http, HttpError},
        rpc::Rpc,
        types::{
            AccountsListSuccess, Agent, AgentBuiltin, AgentTeam, AgentsListSuccess, AgentsTeamsSuccess, Approval, Chat,
            ChatStatus, ChatsListSuccess, MemoriesListSuccess, Memory, ModelInfo, Preferences, Project,
            ProjectsListSuccess, ProviderAccount, Routine, RoutinesListSuccess, SettingsModelsSuccess,
        },
    },
    runtime,
    state::chats::ChatList,
};

/// How `Store::write` changes something on the engine.
#[derive(Clone, Copy)]
pub enum Method {
    Post,
    Patch,
    Put,
    Delete,
}

/// A list fetched by `load`: kept when it came, else the failure is logged and the last one stays.
fn set<T>(field: &mut T, got: Result<T, HttpError>) {
    match got {
        Ok(v) => *field = v,
        Err(e) => eprintln!("store: {e}"),
    }
}

/// A chat's status changed (for notifications and screens that react to it).
pub struct StatusChanged(pub ChatStatus);

impl EventEmitter<StatusChanged> for Store {}

pub struct Store {
    pub http: Http,
    pub rpc: Rpc,
    pub loaded: bool,
    pub agents: Vec<Agent>,
    pub projects: Vec<Project>,
    pub chats: ChatList,
    pub routines: Vec<Routine>,
    pub accounts: Vec<ProviderAccount>,
    pub teams: Vec<AgentTeam>,
    /// What every engine offers (the model picker, model names).
    pub models: Vec<ModelInfo>,
    /// Memories (skills for the composer's $ menu).
    pub memories: Vec<Memory>,
    /// Every open approval and question (Needs you, Home), refreshed when any chat's status changes.
    pub approvals: Vec<Approval>,
    /// All agents paused (Settings › General, the sidebar's Pause).
    pub paused: bool,
    /// Approvals are being re-read; `Some(true)` when statuses moved meanwhile (read once more after).
    approvals_reading: Option<bool>,
}

impl Store {
    pub fn new(http: Http, rpc: Rpc, cx: &mut Context<Self>) -> Self {
        let mut store = Self {
            http,
            rpc,
            loaded: false,
            agents: Vec::new(),
            projects: Vec::new(),
            chats: ChatList::default(),
            routines: Vec::new(),
            accounts: Vec::new(),
            teams: Vec::new(),
            models: Vec::new(),
            memories: Vec::new(),
            approvals: Vec::new(),
            paused: false,
            approvals_reading: None,
        };
        store.load(cx);
        store.refresh_approvals(cx);
        store.follow_statuses(cx);
        store
    }

    /// Reloads everything from REST, every list at once; one that fails keeps what it had.
    pub fn load(&self, cx: &mut Context<Self>) {
        let http = self.http.clone();
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move {
                tokio::join!(
                    http.get::<AgentsListSuccess>("/api/agents"),
                    http.get::<ProjectsListSuccess>("/api/projects"),
                    http.get::<ChatsListSuccess>("/api/chats"),
                    http.get::<RoutinesListSuccess>("/api/routines"),
                    http.get::<AccountsListSuccess>("/api/accounts"),
                    http.get::<Preferences>("/api/preferences"),
                    http.get::<AgentsTeamsSuccess>("/api/teams"),
                    http.get::<SettingsModelsSuccess>("/api/models"),
                    http.get::<MemoriesListSuccess>("/api/memories"),
                )
            })
            .await;
            let Ok((agents, projects, chats, routines, accounts, preferences, teams, models, memories)) = got else {
                return;
            };
            let _ = this.update(cx, |this, cx| {
                set(&mut this.agents, agents.map(|l| l.0));
                set(&mut this.projects, projects.map(|l| l.0));
                set(&mut this.chats.chats, chats.map(|l| l.0));
                set(&mut this.routines, routines.map(|l| l.0));
                set(&mut this.accounts, accounts.map(|l| l.0));
                set(&mut this.paused, preferences.map(|p| p.paused));
                set(&mut this.teams, teams.map(|l| l.0));
                set(&mut this.models, models.map(|l| l.0));
                set(&mut this.memories, memories.map(|l| l.0));
                this.loaded = true;
                cx.notify();
            });
        })
        .detach();
    }

    /// Writes to the engine, then reloads everything (the engine's answer corrects any change shown ahead of it).
    /// Resolves to the engine's answer; a failure is logged and resolves to None.
    pub fn write(
        &self,
        method: Method,
        path: impl Into<String>,
        body: Value,
        cx: &mut Context<Self>,
    ) -> Task<Option<Value>> {
        let (http, path) = (self.http.clone(), path.into());
        cx.spawn(async move |this, cx| {
            let sent = runtime::spawn(async move {
                let answer = match method {
                    Method::Post => http.post(&path, &body).await,
                    Method::Patch => http.patch(&path, &body).await,
                    Method::Put => http.put(&path, &body).await,
                    Method::Delete => http.delete(&path).await.map(|()| Value::Null),
                };
                answer.map_err(|e| format!("{path}: {e}"))
            })
            .await;
            let answer = match sent {
                Ok(Ok(v)) => Some(v),
                Ok(Err(e)) => {
                    eprintln!("write {e}");
                    None
                }
                Err(e) => {
                    eprintln!("write: {e}");
                    None
                }
            };
            let _ = this.update(cx, |s, cx| s.load(cx));
            answer
        })
    }

    /// Refetches the chat list (a chat created, renamed or removed elsewhere).
    pub fn reload_chats(&self, cx: &mut Context<Self>) {
        let http = self.http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(chats)) = runtime::spawn(async move { http.get::<ChatsListSuccess>("/api/chats").await }).await
            {
                let _ = this.update(cx, |this, cx| {
                    this.chats.chats = chats.0;
                    cx.notify();
                });
            }
        })
        .detach();
    }

    /// Re-reads the open approvals (RPC `approvals`): one read at a time, and one more if asked meanwhile, so a burst
    /// of statuses costs two reads, not one each.
    fn refresh_approvals(&mut self, cx: &mut Context<Self>) {
        if let Some(again) = &mut self.approvals_reading {
            *again = true;
            return;
        }
        self.approvals_reading = Some(false);
        let rpc = self.rpc.clone();
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move { rpc.call::<Vec<Approval>>("approvals", None).await }).await;
            let _ = this.update(cx, |this, cx| {
                if let Ok(Ok(approvals)) = got {
                    this.approvals = approvals;
                    cx.notify();
                }
                if this.approvals_reading.take() == Some(true) {
                    this.refresh_approvals(cx);
                }
            });
        })
        .detach();
    }

    /// Decides an approval (or answers a question); it leaves the list at once, the refresh confirms.
    pub fn decide(&mut self, id: String, outcome: &'static str, reason: Option<String>, cx: &mut Context<Self>) {
        self.approvals.retain(|a| a.id != id);
        cx.notify();
        let mut payload = serde_json::json!({ "approvalId": id, "outcome": outcome });
        if let Some(reason) = reason.filter(|r| !r.trim().is_empty()) {
            payload["reason"] = serde_json::json!(reason.trim().chars().take(2000).collect::<String>());
        }
        let rpc = self.rpc.clone();
        runtime::spawn(async move {
            if let Err(e) = rpc.call::<serde_json::Value>("decide", Some(payload)).await {
                eprintln!("decide: {e}");
            }
        });
    }

    /// Pauses or resumes every agent (running work stops; new messages and routines wait).
    pub fn set_paused(&mut self, paused: bool, cx: &mut Context<Self>) {
        self.paused = paused;
        cx.notify();
        let http = self.http.clone();
        runtime::spawn(async move {
            if let Err(e) = http
                .put::<_, serde_json::Value>("/api/pause", &serde_json::json!({ "paused": paused }))
                .await
            {
                eprintln!("pause: {e}");
            }
        });
    }

    /// Reads every subscription account's limits again (one at a time, as the web), then reloads the accounts.
    pub fn refresh_limits(&self, cx: &mut Context<Self>) {
        let http = self.http.clone();
        let ids: Vec<String> = self
            .accounts
            .iter()
            .filter(|a| a.logged_in && matches!(a.kind, crate::net::types::ProviderAccountKind::Subscription))
            .map(|a| a.id.clone())
            .collect();
        cx.spawn(async move |this, cx| {
            let fetched = runtime::spawn(async move {
                for id in ids {
                    if let Err(e) = http
                        .post::<_, serde_json::Value>(
                            &format!("/api/accounts/{id}/limits?fresh=1"),
                            &serde_json::json!({}),
                        )
                        .await
                    {
                        eprintln!("limits: {e}");
                    }
                }
                http.get::<AccountsListSuccess>("/api/accounts").await
            })
            .await;
            if let Ok(Ok(accounts)) = fetched {
                let _ = this.update(cx, |this, cx| {
                    this.accounts = accounts.0;
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn follow_statuses(&self, cx: &mut Context<Self>) {
        let mut statuses = self.rpc.stream::<ChatStatus>("subscribeStatus", None);
        cx.spawn(async move |this, cx| {
            while let Some(status) = statuses.recv().await {
                let alive = this.update(cx, |this, cx| {
                    cx.emit(StatusChanged(status.clone()));
                    // A chat it doesn't know: the list is refetched (before the first load, that load brings it).
                    if this.chats.apply_status(status) && this.loaded {
                        this.reload_chats(cx);
                    }
                    this.refresh_approvals(cx); // approvals come and go with statuses
                    cx.notify();
                });
                if alive.is_err() {
                    return;
                }
            }
        })
        .detach();
    }

    pub fn agent(&self, id: &str) -> Option<&Agent> {
        self.agents.iter().find(|a| a.id == id)
    }

    /// An agent's hue: its place in the agents' order (the web's agentTone).
    pub fn tone(&self, id: Option<&str>) -> usize {
        id.and_then(|id| self.agents.iter().position(|a| a.id == id))
            .unwrap_or(0)
    }

    /// An agent's name, or Zorel's when there is none (the chat's assistant).
    pub fn agent_name(&self, id: Option<&str>) -> String {
        id.and_then(|id| self.agent(id))
            .map(|a| a.name.clone())
            .unwrap_or_else(|| rust_i18n::t!("app.name").into_owned())
    }

    /// The approvals the person decides: not the Builder's agent creation (its own screen asks for that).
    pub fn needs_you(&self) -> Vec<Approval> {
        self.approvals
            .iter()
            .filter(|a| {
                let builder = a
                    .agent_id
                    .as_deref()
                    .and_then(|id| self.agent(id))
                    .is_some_and(|x| matches!(x.builtin, Some(AgentBuiltin::Builder)));
                !(a.tool == "zorel_create_agent" && builder)
            })
            .cloned()
            .collect()
    }

    pub fn chat(&self, id: &str) -> Option<&Chat> {
        self.chats.chats.iter().find(|c| c.id == id)
    }

    pub fn status(&self, chat_id: &str) -> Option<&ChatStatus> {
        self.chats.statuses.get(chat_id)
    }
}
