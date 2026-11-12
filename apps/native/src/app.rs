// The app (spec 019): one window on gpui-base. Starts this computer's engine (development: the server in this
// checkout, run by bun), or attaches to a running one with `--engine <url> --token <secret>`.
use std::path::PathBuf;

use gpui_kit::*;
use rust_i18n::t;

use crate::{
    engine::Launch,
    i18n,
    state::connection::{ConnectionState, EngineConnection, Target},
    theme::tokens,
};

struct Root {
    connection: Entity<EngineConnection>,
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let status = match &self.connection.read(cx).state {
            ConnectionState::Starting => t!("app.starting").into_owned(),
            ConnectionState::Ready => t!("app.name").into_owned(),
            ConnectionState::Reconnecting => t!("app.offline").into_owned(),
            ConnectionState::Down(reason) => t!("app.stopped", reason = reason).into_owned(),
        };
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(tokens::DARK.bg_canvas)
            .text_color(tokens::DARK.text)
            .child(status)
    }
}

fn target() -> Target {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
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
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| {
                cx.observe(&connection, |_, _, cx| cx.notify()).detach();
                Root { connection }
            })
        })
        .expect("open the window");
    });
}
