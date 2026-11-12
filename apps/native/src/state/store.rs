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
            Agent, AgentsListSuccess, Chat, ChatStatus, ChatsListSuccess, Project, ProjectsListSuccess, Routine,
            RoutinesListSuccess,
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
        };
        store.load(cx);
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
                Ok::<_, HttpError>((agents, projects, chats, routines))
            })
            .await;
            match got {
                Ok(Ok((agents, projects, chats, routines))) => {
                    let _ = this.update(cx, |this, cx| {
                        this.agents = agents.0;
                        this.projects = projects.0;
                        this.chats.chats = chats.0;
                        this.routines = routines.0;
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

    fn follow_statuses(&self, cx: &mut Context<Self>) {
        let mut statuses = self.rpc.stream::<ChatStatus>("subscribeStatus", None);
        cx.spawn(async move |this, cx| {
            while let Some(status) = statuses.recv().await {
                let alive = this.update(cx, |this, cx| {
                    cx.emit(StatusChanged(status.clone()));
                    if this.chats.apply_status(status) {
                        this.reload_chats(cx);
                    }
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
