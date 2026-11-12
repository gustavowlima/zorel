// The engine connection (spec 019 data-model: EngineConnection): starting → ready ⇄ reconnecting, or down with a
// reason. It owns the Engine (dropping it stops a server this app started) and hands out the HTTP and RPC clients.
use gpui_kit::Context;

use crate::{
    engine::{Engine, EngineError, Launch},
    net::{http::Http, rpc::Rpc},
    runtime,
};

pub enum ConnectionState {
    Starting,
    Ready,
    Reconnecting,
    Down(String),
}

/// How to reach the engine: start this computer's, or attach to one already running.
pub enum Target {
    Start(Launch),
    Attach { url: String, token: String },
}

pub struct EngineConnection {
    pub state: ConnectionState,
    pub http: Option<Http>,
    pub rpc: Option<Rpc>,
    _engine: Option<Engine>,
}

impl EngineConnection {
    pub fn new(target: Target, cx: &mut Context<Self>) -> Self {
        cx.spawn(async move |this, cx| {
            let started = runtime::spawn(async move {
                let engine = match target {
                    Target::Start(launch) => Engine::start(launch).await?,
                    Target::Attach { url, token } => Engine::attach(url, token),
                };
                let rpc = Rpc::connect(&engine);
                Ok::<_, EngineError>((engine, rpc))
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r.map_err(|e| e.to_string()));
            let mut connected = match started {
                Ok((engine, rpc)) => {
                    let connected = rpc.connected();
                    let _ = this.update(cx, |this, cx| {
                        this.http = Some(Http::new(&engine));
                        this.rpc = Some(rpc);
                        this._engine = Some(engine);
                        cx.notify();
                    });
                    connected
                }
                Err(reason) => {
                    eprintln!("engine: down: {reason}");
                    let _ = this.update(cx, |this, cx| {
                        this.state = ConnectionState::Down(reason);
                        cx.notify();
                    });
                    return;
                }
            };
            // Follow the socket: ready while it's up, reconnecting while it isn't.
            loop {
                let up = *connected.borrow_and_update();
                eprintln!("engine: {}", if up { "connected" } else { "not connected" });
                let alive = this.update(cx, |this, cx| {
                    this.state = match (up, &this.state) {
                        (true, _) => ConnectionState::Ready,
                        (false, ConnectionState::Starting) => ConnectionState::Starting, // not connected yet
                        (false, _) => ConnectionState::Reconnecting,
                    };
                    cx.notify();
                });
                if alive.is_err() {
                    return; // the entity is gone
                }
                let changed = runtime::spawn(async move {
                    let ok = connected.changed().await.is_ok();
                    (connected, ok)
                })
                .await;
                match changed {
                    Ok((rx, true)) => connected = rx,
                    _ => return, // the RPC task ended
                }
            }
        })
        .detach();
        Self {
            state: ConnectionState::Starting,
            http: None,
            rpc: None,
            _engine: None,
        }
    }
}
