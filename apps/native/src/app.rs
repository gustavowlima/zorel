// The app (spec 019): one window on gpui-kit. Starts this computer's engine (development: the server in this
// checkout, run by bun), or attaches to a running one with `--engine <url> --token <secret>`. Once the engine is up,
// the Store loads what every screen reads; the sidebar and the main area follow a Route, as the web's.
use std::path::PathBuf;

use gpui_kit::{component as gpui_component, prelude::FluentBuilder, *};
use rust_i18n::t;

use crate::{
    engine::Launch,
    i18n,
    net::types::{ChatStatus, Notice},
    route::Route,
    screens::{
        chat::ChatScreen,
        home::{Home, HomeEvent},
        inbox::{Inbox, InboxEvent},
        palette,
        sidebar::{Sidebar, SidebarEvent},
    },
    shell::{
        menus::{OpenPalette, ToggleSidebar},
        notify::{self, Moment, Notifier},
    },
    state::{
        connection::{ConnectionState, EngineConnection, Target},
        store::{StatusChanged, Store},
    },
    theme,
};

struct Root {
    connection: Entity<EngineConnection>,
    store: Option<Entity<Store>>,
    route: Route,
    /// The open chat's screen (kept while its chat is open; a new chat builds a new one).
    chat: Option<(String, Entity<ChatScreen>)>,
    inbox: Option<Entity<Inbox>>,
    home: Option<Entity<Home>>,
    sidebar: Option<Entity<Sidebar>>,
    notifier: Notifier,
    /// A clicked notification sends its chat id here.
    clicked: tokio::sync::mpsc::UnboundedSender<String>,
    /// `--open <chat id>`: the chat to open once loaded (measurements, deep links).
    open_first: Option<String>,
    /// Keyboard actions (⌘K, ⌘B) dispatch from the focused element up: the root holds focus when nothing else does.
    focus: FocusHandle,
}

impl Root {
    fn new(connection: Entity<EngineConnection>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.observe_in(&connection, window, |this, connection, window, cx| {
            if this.store.is_none() && matches!(connection.read(cx).state, ConnectionState::Ready) {
                this.start(window, cx);
            }
            cx.notify();
        })
        .detach();
        cx.observe_window_appearance(window, |_, window, cx| {
            theme::follow_system(window, cx); // light/dark follows the system, for the kit's components too
            cx.notify();
        })
        .detach();
        let (clicked, mut clicks) = tokio::sync::mpsc::unbounded_channel::<String>();
        cx.spawn_in(window, async move |this, cx| {
            while let Some(chat_id) = clicks.recv().await {
                let _ = this.update_in(cx, |this, window, cx| {
                    cx.activate(true);
                    window.activate_window();
                    this.navigate(Route::Chat { id: chat_id }, window, cx);
                });
            }
        })
        .detach();
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let open_first = flag("--open");
        let route = open_first.clone().map(|id| Route::Chat { id }).unwrap_or_default();
        Self {
            connection,
            store: None,
            route,
            chat: None,
            inbox: None,
            home: None,
            sidebar: None,
            notifier: Notifier::default(),
            clicked,
            open_first,
            focus,
        }
    }

    // The engine is up: the shared Store, Needs you, notifications.
    fn start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let connection = self.connection.read(cx);
        let (Some(http), Some(rpc)) = (connection.http.clone(), connection.rpc.clone()) else {
            return;
        };
        let mut notices = rpc.stream::<Notice>("notices", None);
        let store = cx.new(|cx| Store::new(http, rpc, cx));
        cx.observe_in(&store, window, |this, store, window, cx| {
            if store.read(cx).loaded
                && let Some(id) = this.open_first.take()
            {
                this.navigate(Route::Chat { id }, window, cx);
            }
            cx.notify();
        })
        .detach();
        cx.subscribe_in(&store, window, |this, _, StatusChanged(status), window, cx| {
            this.notify_status(status, window, cx)
        })
        .detach();
        let inbox = cx.new(|cx| Inbox::new(store.clone(), cx));
        cx.subscribe_in(&inbox, window, |this, _, event: &InboxEvent, window, cx| match event {
            InboxEvent::OpenChat(id) => this.navigate(Route::Chat { id: id.clone() }, window, cx),
        })
        .detach();
        let home = cx.new(|cx| Home::new(store.clone(), window, cx));
        cx.subscribe_in(&home, window, |this, _, event: &HomeEvent, window, cx| match event {
            HomeEvent::Navigate(route) => this.navigate(route.clone(), window, cx),
        })
        .detach();
        let sidebar = cx.new(|cx| Sidebar::new(store.clone(), cx));
        cx.subscribe_in(
            &sidebar,
            window,
            |this, _, event: &SidebarEvent, window, cx| match event {
                SidebarEvent::Navigate(route) => this.navigate(route.clone(), window, cx),
                SidebarEvent::Palette => this.open_palette(window, cx),
            },
        )
        .detach();
        // Needs you's count shows in the sidebar.
        cx.observe(&inbox, |this, inbox, cx| {
            let pending = inbox.read(cx).count(cx);
            if let Some(sidebar) = &this.sidebar {
                sidebar.update(cx, |s, cx| {
                    s.pending = pending;
                    cx.notify();
                });
            }
        })
        .detach();
        cx.spawn_in(window, async move |this, cx| {
            while let Some(notice) = notices.recv().await {
                let _ = this.update_in(cx, |this, window, _| {
                    if !this.looking_at(&notice.chat_id, window) {
                        notify::show(
                            notice.title.clone(),
                            notify::notice_body(&notice),
                            notice.chat_id.clone(),
                            this.clicked.clone(),
                        );
                    }
                });
            }
        })
        .detach();
        self.store = Some(store);
        self.inbox = Some(inbox);
        self.home = Some(home);
        self.sidebar = Some(sidebar);
        if let Route::Chat { id } = self.route.clone() {
            self.navigate(Route::Chat { id }, window, cx);
        }
    }

    // ⌘K: the palette; what it picks comes back here.
    fn open_palette(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(store) = self.store.clone() else { return };
        let root = cx.entity().downgrade();
        let on_pick: palette::OnPick = std::rc::Rc::new(move |target, window, cx| {
            let _ = root.update(cx, |this, cx| match target {
                palette::Target::Go(route) => this.navigate(route, window, cx),
                palette::Target::ToggleSidebar => this.toggle_sidebar(cx),
            });
        });
        palette::open(&store, on_pick, window, cx);
    }

    fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        if let Some(sidebar) = &self.sidebar {
            sidebar.update(cx, |s, cx| s.toggle_folded(cx));
        }
    }

    fn navigate(&mut self, route: Route, window: &mut Window, cx: &mut Context<Self>) {
        match &route {
            Route::Chat { id } => self.open_chat(id.clone(), window, cx),
            Route::Inbox => {
                if let Some(inbox) = &self.inbox {
                    inbox.update(cx, |inbox, cx| inbox.refresh(cx));
                }
            }
            Route::Home { project_id } => {
                if let Some(home) = &self.home {
                    let project_id = project_id.clone();
                    home.update(cx, |home, cx| {
                        home.set_project(project_id, window, cx);
                        home.refresh(cx);
                    });
                }
            }
        }
        if let Some(sidebar) = &self.sidebar {
            let route = route.clone();
            sidebar.update(cx, |s, cx| {
                s.route = route;
                cx.notify();
            });
        }
        self.route = route;
        cx.notify();
    }

    fn open_chat(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.chat.as_ref().is_some_and(|(open, _)| *open == id) {
            return;
        }
        let Some(store) = self.store.clone() else { return };
        let screen = cx.new(|cx| ChatScreen::new(id.clone(), store, window, cx));
        self.chat = Some((id, screen));
    }

    // Whether the person is looking at this chat right now (no notification then).
    fn looking_at(&self, chat_id: &str, window: &Window) -> bool {
        window.is_window_active()
            && self.route
                == (Route::Chat {
                    id: chat_id.to_string(),
                })
    }

    // A chat that starts waiting, fails or finishes while you look elsewhere (not a routine's chat: its notices tell).
    fn notify_status(&mut self, status: &ChatStatus, window: &Window, cx: &mut Context<Self>) {
        let Some(store) = self.store.clone() else { return };
        let store = store.read(cx);
        self.notifier.routine_chats = store.routines.iter().map(|r| r.chat_id.clone()).collect();
        let Some(moment) = self.notifier.moment(&status.chat_id, status.state) else {
            return;
        };
        if self.looking_at(&status.chat_id, window) {
            return;
        }
        let title = store
            .chat(&status.chat_id)
            .map(|c| c.title.clone())
            .filter(|t| !t.is_empty());
        let agent = store.agent_name(status.agent_id.as_deref());
        let body = match moment {
            Moment::Done => t!("notify.done").into_owned(),
            Moment::Failed => t!("status.failed").into_owned(),
            Moment::Waiting if status.label == "question" => t!("status.asking", agent = agent).into_owned(),
            Moment::Waiting => t!("status.waiting", agent = agent).into_owned(),
        };
        notify::show(
            title.unwrap_or_else(|| t!("app.name").into_owned()),
            body,
            status.chat_id.clone(),
            self.clicked.clone(),
        );
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
        let main: Option<AnyElement> = match &self.route {
            Route::Inbox => self.inbox.clone().map(|i| i.into_any_element()),
            Route::Chat { id } => self
                .chat
                .as_ref()
                .filter(|(open, _)| open == id)
                .map(|(_, s)| s.clone().into_any_element()),
            Route::Home { .. } => self.home.clone().map(|h| h.into_any_element()),
        };
        div()
            .size_full()
            .flex()
            .bg(p.bg_frame)
            .text_color(p.text)
            .text_size(px(13.5))
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &OpenPalette, window, cx| this.open_palette(window, cx)))
            .on_action(cx.listener(|this, _: &ToggleSidebar, _, cx| this.toggle_sidebar(cx)))
            .when_some(self.sidebar.clone(), |c, sidebar| c.child(sidebar))
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

/// What outlives any window: the engine connection and the tray. Closing the window never quits (the engine keeps
/// running turns and routines); the Dock (macOS), the tray (Windows, Linux) or a second launch brings it back.
struct Shell {
    connection: Entity<EngineConnection>,
    window: Option<AnyWindowHandle>, // the kit wraps our Root in its own root view, so this stays untyped
    _tray: Option<gpui_tray::Tray>,
}

impl Global for Shell {}

/// Brings the main window forward, opening it again if it was closed.
pub fn show_window(cx: &mut App) {
    let (existing, connection) = {
        let shell = cx.global::<Shell>();
        (shell.window, shell.connection.clone())
    };
    if let Some(handle) = existing
        && handle.update(cx, |_, window, _| window.activate_window()).is_ok()
    {
        cx.activate(true);
        return;
    }
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
    let opened = gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Root::new(connection, window, cx)));
    match opened {
        Ok((handle, _)) => cx.global_mut::<Shell>().window = Some(handle),
        Err(e) => eprintln!("couldn't open the window: {e}"),
    }
    cx.activate(true);
}

pub fn run() {
    i18n::init();
    let target = target();
    let app = gpui_kit::application()
        .with_assets(crate::assets::Assets)
        .with_quit_mode(QuitMode::Explicit);
    app.on_reopen(show_window);
    app.run(move |cx| {
        // The kit's own component strings (it ships pt-BR) follow the same language as ours.
        rust_i18n::extend!(gpui_component);
        gpui_kit::init(cx);
        theme::install(cx);
        crate::shell::menus::install(cx);
        let connection = cx.new(|cx| EngineConnection::new(target, cx));
        let tray = crate::shell::tray::install(cx);
        cx.set_global(Shell {
            connection,
            window: None,
            _tray: tray,
        });
        cx.on_action(|_: &crate::shell::tray::OpenZorel, cx| show_window(cx));
        show_window(cx);
    });
}
