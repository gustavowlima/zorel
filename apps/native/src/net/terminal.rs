// The Terminal tab's socket (packages/contracts terminal.ts): GET /api/terminals?chat&cols&rows[&session|&run], up
// TerminalFrame JSON ({"t":"i",d} input, {"t":"r",c,r} resize, {"t":"k"} kill), down {"t":"s",id,n} (attached; the
// recent screen's replay follows) as text and the shell's output as bytes. Close code 4000: the shell ended. A dropped
// connection retries 5 times (500 ms more each), reattaching to its session.
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{Message, protocol::frame::coding::CloseCode};

use crate::{net::http::Http, runtime};

const RETRIES: u32 = 5;

/// What goes up.
pub enum Up {
    Input(String),
    Resize(u16, u16),
    Kill,
}

/// What comes down.
pub enum Down {
    /// On session `id` (its number in the chat); a replay of the screen follows.
    Attached {
        id: String,
        n: u32,
    },
    Output(Vec<u8>),
    /// The shell ended, or its session is gone.
    Ended,
}

/// Opens (or reattaches to) a shell of `chat`; frames go up on the sender, what happens comes down on the receiver.
pub fn connect(
    http: Http,
    chat: String,
    session: Option<String>,
    size: (u16, u16),
) -> (mpsc::UnboundedSender<Up>, mpsc::UnboundedReceiver<Down>) {
    let (up_tx, mut up_rx) = mpsc::unbounded_channel::<Up>();
    let (down_tx, down_rx) = mpsc::unbounded_channel::<Down>();
    runtime::spawn(async move {
        let mut session = session;
        let mut size = size;
        let mut tries = 0;
        loop {
            let mut query = format!("/api/terminals?chat={chat}&cols={}&rows={}", size.0, size.1);
            if let Some(id) = &session {
                query.push_str(&format!("&session={id}"));
            }
            let Ok(req) = http.socket(&query) else { break };
            let socket = match tokio_tungstenite::connect_async(req).await {
                Ok((s, _)) => s,
                Err(_) => {
                    tries += 1;
                    if tries > RETRIES {
                        let _ = down_tx.send(Down::Ended);
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(500 * tries as u64)).await;
                    continue;
                }
            };
            let (mut sink, mut stream) = socket.split();
            let mut attached = false;
            let ended = loop {
                tokio::select! {
                    frame = up_rx.recv() => {
                        let Some(frame) = frame else { return }; // the tab is gone: leave the session running
                        let text = match frame {
                            Up::Input(d) => serde_json::json!({ "t": "i", "d": d }),
                            Up::Resize(c, r) => {
                                size = (c, r);
                                serde_json::json!({ "t": "r", "c": c, "r": r })
                            }
                            Up::Kill => serde_json::json!({ "t": "k" }),
                        };
                        if sink.send(Message::text(text.to_string())).await.is_err() {
                            break false;
                        }
                    }
                    msg = stream.next() => match msg {
                        Some(Ok(Message::Text(t))) => {
                            let v: serde_json::Value = serde_json::from_str(&t).unwrap_or_default();
                            if let Some(id) = v["id"].as_str() {
                                attached = true;
                                tries = 0;
                                session = Some(id.to_string());
                                let n = v["n"].as_u64().unwrap_or(1) as u32;
                                let _ = down_tx.send(Down::Attached { id: id.to_string(), n });
                                let _ = sink
                                    .send(Message::text(serde_json::json!({ "t": "r", "c": size.0, "r": size.1 }).to_string()))
                                    .await;
                            }
                        }
                        Some(Ok(Message::Binary(b))) => {
                            let _ = down_tx.send(Down::Output(b.to_vec()));
                        }
                        Some(Ok(Message::Close(frame))) => {
                            break frame.is_some_and(|f| f.code == CloseCode::Library(4000));
                        }
                        Some(Ok(_)) => {}
                        Some(Err(_)) | None => break false,
                    }
                }
            };
            // Ended, or a known session that won't take us back: stop.
            if ended || (!attached && session.is_some() && tries >= 1) {
                let _ = down_tx.send(Down::Ended);
                break;
            }
            tries += 1;
            if tries > RETRIES {
                let _ = down_tx.send(Down::Ended);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500 * tries as u64)).await;
        }
    });
    (up_tx, down_rx)
}
