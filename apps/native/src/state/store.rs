// What every screen reads (spec 019): agents, projects, chats with their live statuses, routines — loaded once over
// REST when the engine is up, kept current by the status stream (a chat it doesn't know makes it refetch the list).
// Screens hold an `Entity<Store>` and observe it; mutations go through its `http`/`rpc` and the stream brings the
// result back. Mirrors the web's shared atoms (apps/web/src/client.ts).
use gpui_kit::*;

use crate::{
    net::{
        http::{Http, HttpError},
        rpc::Rpc,
        types::{
            AccountsListSuccess, Agent, AgentTeam, AgentsListSuccess, AgentsTeamsSuccess, Approval, Chat, ChatStatus,
            ChatsListSuccess, Preferences, Project, ProjectsListSuccess, ProviderAccount, Routine, RoutinesListSuccess,
        },
    },
    runtime,
    state::chats::ChatList,
};

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
    /// Every open approval and question (Needs you, Home), refreshed when any chat's status changes.
    pub approvals: Vec<Approval>,
    /// All agents paused (Settings › General, the sidebar's Pause).
    pub paused: bool,
}

impl Store {
    pub fn new(http: Http, rpc: Rpc, cx: &mut Context<Self>) -> Self {
        let store = Self {
            http,
            rpc,
            loaded: false,
            agents: Vec::new(),
            projects: Vec::new(),
            chats: ChatList::default(),
            routines: Vec::new(),
            accounts: Vec::new(),
            teams: Vec::new(),
            approvals: Vec::new(),
            paused: false,
        };
        store.load(cx);
        store.refresh_approvals(cx);
        store.follow_statuses(cx);
        store
    }

    /// Reloads everything from REST.
    pub fn load(&self, cx: &mut Context<Self>) {
        let http = self.http.clone();
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move {
                let agents: AgentsListSuccess = http.get("/api/agents").await?;
                let projects: ProjectsListSuccess = http.get("/api/projects").await?;
                let chats: ChatsListSuccess = http.get("/api/chats").await?;
                let routines: RoutinesListSuccess = http.get("/api/routines").await?;
                let accounts: AccountsListSuccess = http.get("/api/accounts").await?;
                let preferences: Preferences = http.get("/api/preferences").await?;
                let teams: AgentsTeamsSuccess = http.get("/api/teams").await?;
                Ok::<_, HttpError>((agents, projects, chats, routines, accounts, preferences, teams))
            })
            .await;
            match got {
                Ok(Ok((agents, projects, chats, routines, accounts, preferences, teams))) => {
                    let _ = this.update(cx, |this, cx| {
                        this.agents = agents.0;
                        this.projects = projects.0;
                        this.chats.chats = chats.0;
                        this.routines = routines.0;
                        this.accounts = accounts.0;
                        this.paused = preferences.paused;
                        this.teams = teams.0;
                        this.loaded = true;
                        cx.notify();
                    });
                }
                Ok(Err(e)) => eprintln!("store: {e}"),
                Err(e) => eprintln!("store: {e}"),
            }
        })
        .detach();
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

    /// Re-reads the open approvals (RPC `approvals`).
    pub fn refresh_approvals(&self, cx: &mut Context<Self>) {
        let rpc = self.rpc.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(approvals)) =
                runtime::spawn(async move { rpc.call::<Vec<Approval>>("approvals", None).await }).await
            {
                let _ = this.update(cx, |this, cx| {
                    this.approvals = approvals;
                    cx.notify();
                });
            }
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
                    if this.chats.apply_status(status) {
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

    pub fn chat(&self, id: &str) -> Option<&Chat> {
        self.chats.chats.iter().find(|c| c.id == id)
    }

    pub fn status(&self, chat_id: &str) -> Option<&ChatStatus> {
        self.chats.statuses.get(chat_id)
    }
}
