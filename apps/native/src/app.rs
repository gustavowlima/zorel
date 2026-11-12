// The app (spec 019): one window on gpui-base. Starts this computer's engine (development: the server in this
// checkout, run by bun), or attaches to a running one with `--engine <url> --token <secret>`. Once the engine is up:
// the sidebar (every chat, live statuses) and the open chat.
use std::{collections::HashMap, path::PathBuf};

use gpui_kit::{prelude::FluentBuilder, *};
use rust_i18n::t;

use crate::{
    engine::Launch,
    i18n,
    net::types::{AgentsListSuccess, ChatStatus, ChatsListSuccess},
    runtime,
    screens::{
        chat::ChatScreen,
        inbox::{Directory, Inbox, InboxEvent},
        sidebar,
    },
    state::{
        chats::ChatList,
        connection::{ConnectionState, EngineConnection, Target},
    },
    theme,
};

struct Root {
    connection: Entity<EngineConnection>,
    loaded: bool,
    chats: ChatList,
    /// Each agent's hue index, in the agents' order.
    tones: HashMap<String, usize>,
    agent_names: HashMap<String, String>,
    open: Option<(String, Entity<ChatScreen>)>,
    /// Needs you; shown instead of a chat when `inbox_open`.
    inbox: Option<Entity<Inbox>>,
    inbox_open: bool,
    /// `--open <chat id>`: the chat to open once loaded (the prototype's measurements).
    open_first: Option<String>,
}

impl Root {
    fn new(connection: Entity<EngineConnection>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.observe_in(&connection, window, |this, _, window, cx| {
            if !this.loaded && matches!(this.connection.read(cx).state, ConnectionState::Ready) {
                this.loaded = true;
                this.load(window, cx);
            }
            cx.notify();
        })
        .detach();
        cx.observe_window_appearance(window, |_, _, cx| cx.notify()).detach(); // light/dark follows the system
        Self {
            connection,
            loaded: false,
            chats: ChatList::default(),
            tones: HashMap::new(),
            agent_names: HashMap::new(),
            open: None,
            inbox: None,
            inbox_open: false,
            open_first: flag("--open"),
        }
    }

    // The agents and chats over REST, then every chat's status as it changes.
    fn load(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let connection = self.connection.read(cx);
        let (Some(http), Some(rpc)) = (connection.http.clone(), connection.rpc.clone()) else {
            return;
        };
        let mut statuses = rpc.stream::<ChatStatus>("subscribeStatus", None);
        let inbox = cx.new(|cx| Inbox::new(http.clone(), rpc.clone(), cx));
        cx.subscribe_in(&inbox, window, |this, _, event: &InboxEvent, window, cx| match event {
            InboxEvent::OpenChat(id) => this.open_chat(id.clone(), window, cx),
        })
        .detach();
        cx.observe(&inbox, |_, _, cx| cx.notify()).detach(); // its count shows in the sidebar
        self.inbox = Some(inbox);
        cx.spawn(async move |this, cx| {
            let fetch = http.clone();
            let lists = runtime::spawn(async move {
                let agents: AgentsListSuccess = fetch.get("/api/agents").await?;
                let chats: ChatsListSuccess = fetch.get("/api/chats").await?;
                Ok::<_, crate::net::http::HttpError>((agents, chats))
            })
            .await;
            match lists {
                Ok(Ok((agents, chats))) => {
                    let _ = this.update_in(cx, |this, window, cx| {
                        this.tones = agents.iter().enumerate().map(|(i, a)| (a.id.clone(), i)).collect();
                        this.agent_names = agents.iter().map(|a| (a.id.clone(), a.name.clone())).collect();
                        this.chats.chats = chats.0;
                        this.share_directory(cx);
                        if let Some(id) = this.open_first.take() {
                            this.open_chat(id, window, cx);
                        }
                        cx.notify();
                    });
                }
                Ok(Err(e)) => eprintln!("load: {e}"),
                Err(e) => eprintln!("load: {e}"),
            }
            while let Some(status) = statuses.recv().await {
                let unknown = this.update(cx, |this, cx| {
                    let unknown = this.chats.apply_status(status);
                    if let Some(inbox) = &this.inbox {
                        inbox.update(cx, |inbox, cx| inbox.refresh(cx)); // approvals come and go with statuses
                    }
                    cx.notify();
                    unknown
                });
                match unknown {
                    Err(_) => return,
                    // A chat created elsewhere: refetch the list.
                    Ok(true) => {
                        let fetch = http.clone();
                        if let Ok(Ok(chats)) =
                            runtime::spawn(async move { fetch.get::<ChatsListSuccess>("/api/chats").await }).await
                        {
                            let _ = this.update(cx, |this, cx| {
                                this.chats.chats = chats.0;
                                this.share_directory(cx);
                                cx.notify();
                            });
                        }
                    }
                    Ok(false) => {}
                }
            }
        })
        .detach();
    }

    // Chat titles and agent names for the screens that show other chats' items (Needs you).
    fn share_directory(&mut self, cx: &mut Context<Self>) {
        let Some(inbox) = &self.inbox else { return };
        let directory = Directory {
            chat_titles: self
                .chats
                .chats
                .iter()
                .map(|c| (c.id.clone(), c.title.clone()))
                .collect(),
            agents: self
                .agent_names
                .iter()
                .map(|(id, name)| (id.clone(), (name.clone(), self.tones.get(id).copied().unwrap_or(0))))
                .collect(),
        };
        inbox.update(cx, |inbox, cx| {
            inbox.directory = directory;
            cx.notify();
        });
    }

    fn open_inbox(&mut self, cx: &mut Context<Self>) {
        self.inbox_open = true;
        if let Some(inbox) = &self.inbox {
            inbox.update(cx, |inbox, cx| inbox.refresh(cx));
        }
        cx.notify();
    }

    fn open_chat(&mut self, chat_id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.inbox_open = false;
        if self.open.as_ref().is_some_and(|(id, _)| *id == chat_id) {
            cx.notify();
            return;
        }
        let Some(rpc) = self.connection.read(cx).rpc.clone() else {
            return;
        };
        let tones = self.tones.clone();
        let screen = cx.new(|cx| ChatScreen::new(chat_id.clone(), rpc, tones, window, cx));
        self.open = Some((chat_id, screen));
        cx.notify();
    }

    fn tone_of(&self, agent_ids: &[String]) -> usize {
        agent_ids.first().and_then(|a| self.tones.get(a)).copied().unwrap_or(0)
    }
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        let status = match &self.connection.read(cx).state {
            ConnectionState::Starting => Some(t!("app.starting").into_owned()),
            ConnectionState::Ready => None,
            ConnectionState::Reconnecting => Some(t!("app.offline").into_owned()),
            ConnectionState::Down(reason) => Some(t!("app.stopped", reason = reason).into_owned()),
        };
        // ponytail: every row is built each render (fine for hundreds of chats); a uniform_list when it isn't.
        let rows: Vec<AnyElement> = sidebar::ordered(&self.chats)
            .into_iter()
            .map(|chat| {
                let active = !self.inbox_open && self.open.as_ref().is_some_and(|(id, _)| *id == chat.id);
                let id = chat.id.clone();
                sidebar::row(
                    chat,
                    self.chats.statuses.get(&chat.id),
                    self.tone_of(&chat.agent_ids),
                    active,
                    p,
                )
                .on_click(cx.listener(move |this, _, window, cx| this.open_chat(id.clone(), window, cx)))
                .into_any_element()
            })
            .collect();
        let pending = self.inbox.as_ref().map(|i| i.read(cx).count()).unwrap_or(0);
        let inbox_row = div()
            .id("nav-inbox")
            .flex()
            .items_center()
            .h(px(32.))
            .px(px(8.))
            .mb(px(8.))
            .rounded(px(theme::tokens::RADIUS_ROW))
            .text_color(if self.inbox_open { p.text } else { p.text_secondary })
            .when(self.inbox_open, |r| r.bg(p.bg_control_active))
            .when(!self.inbox_open, |r| r.hover(|s| s.bg(p.bg_hover)))
            .child(div().flex_1().child(t!("inbox.title").into_owned()))
            .when(pending > 0, |r| {
                r.child(div().text_color(p.warning).child(pending.to_string()))
            })
            .on_click(cx.listener(|this, _, _, cx| this.open_inbox(cx)));
        let main: Option<AnyElement> = if self.inbox_open {
            self.inbox.clone().map(|i| i.into_any_element())
        } else {
            self.open.as_ref().map(|(_, s)| s.clone().into_any_element())
        };
        div()
            .size_full()
            .flex()
            .bg(p.bg_frame)
            .text_color(p.text)
            .text_size(px(13.5))
            .child(
                div()
                    .w(px(260.))
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(1.))
                    .p(px(8.))
                    .pt(px(40.))
                    .child(inbox_row)
                    .children(rows),
            )
            .child(
                div()
                    .flex_1()
                    .m(px(8.))
                    .ml(px(0.))
                    .rounded(px(theme::tokens::RADIUS_CARD))
                    .overflow_hidden()
                    .bg(p.bg_canvas)
                    .border_1()
                    .border_color(p.border)
                    .flex()
                    .flex_col()
                    .when_some(status, |c, s| {
                        c.child(div().p(px(8.)).text_color(p.text_muted).child(s))
                    })
                    .when_some(main, |c, screen| c.child(screen)),
            )
    }
}

fn flag(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn target() -> Target {
    match (flag("--engine"), flag("--token")) {
        (Some(url), Some(token)) => Target::Attach { url, token },
        // ponytail: development only (this checkout's server); the packaged sidecar comes with T048.
        _ => Target::Start(Launch::dev(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))),
    }
}

pub fn run() {
    i18n::init();
    let target = target();
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        let connection = cx.new(|cx| EngineConnection::new(target, cx));
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1200.), px(800.)),
                cx,
            ))),
            titlebar: Some(TitlebarOptions {
                title: Some("Zorel".into()),
                appears_transparent: true,
                ..Default::default()
            }),
            ..Default::default()
        };
        gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Root::new(connection, window, cx)))
            .expect("open the window");
    });
}
