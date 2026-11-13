// The Browser tab's socket (packages/contracts browser.ts): GET /api/browser?chat, up PanelFrame JSON (click, wheel,
// key, text, nav, open, back/forward/reload/release/previews, newtab, tab/close/view), down PanelMessage JSON as text
// (state, act, previews, error) and the active tab's frames as binary JPEG. A dropped connection retries 5 times.
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::{net::http::Http, runtime};

const RETRIES: u32 = 5;

pub enum Down {
    Message(serde_json::Value),
    Frame(Vec<u8>),
    Closed,
}

/// Opens the chat's browser socket; frames go up as JSON values.
pub fn connect(http: Http, chat: String) -> (mpsc::UnboundedSender<serde_json::Value>, mpsc::UnboundedReceiver<Down>) {
    let (up_tx, mut up_rx) = mpsc::unbounded_channel::<serde_json::Value>();
    let (down_tx, down_rx) = mpsc::unbounded_channel::<Down>();
    runtime::spawn(async move {
        let mut tries = 0;
        loop {
            let Ok(req) = http.socket(&format!("/api/browser?chat={chat}")) else {
                break;
            };
            if let Ok((socket, _)) = tokio_tungstenite::connect_async(req).await {
                tries = 0;
                let (mut sink, mut stream) = socket.split();
                loop {
                    tokio::select! {
                        frame = up_rx.recv() => {
                            let Some(frame) = frame else { return };
                            if sink.send(Message::text(frame.to_string())).await.is_err() {
                                break;
                            }
                        }
                        msg = stream.next() => match msg {
                            Some(Ok(Message::Text(t))) => {
                                if let Ok(v) = serde_json::from_str(&t) {
                                    let _ = down_tx.send(Down::Message(v));
                                }
                            }
                            Some(Ok(Message::Binary(b))) => {
                                let _ = down_tx.send(Down::Frame(b.to_vec()));
                            }
                            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                            Some(Ok(_)) => {}
                        }
                    }
                }
            }
            tries += 1;
            if tries > RETRIES {
                let _ = down_tx.send(Down::Closed);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500 * tries as u64)).await;
        }
    });
    (up_tx, down_rx)
}
