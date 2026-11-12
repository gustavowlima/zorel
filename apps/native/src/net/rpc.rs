// The engine's RPC (spec 019 T019): Effect's rpc protocol over the WebSocket at /rpc, JSON serialization. Not part of
// the contract (it's Effect's own envelope, effect/dist/rpc/RpcMessage.d.ts), so it lives here, checked against a live
// engine by tests/rpc_live.rs:
//   up:   {_tag:"Request", id, tag, payload, headers:[]} · {_tag:"Ack", requestId} after each chunk (the server sends
//         the next chunk only then) · {_tag:"Interrupt", requestId} · {_tag:"Ping"}
//   down: {_tag:"Chunk", requestId, values:[…]} · {_tag:"Exit", requestId, exit:{_tag:"Success",value}|{_tag:"Failure",
//         cause:[…]}} · {_tag:"Defect", defect} · {_tag:"Pong"}
// One socket per engine, owned by a task. Streams survive a dropped connection: the task reconnects with backoff
// (0.5 s → 10 s) and asks for each live stream again; the engine starts every stream with a fresh snapshot, so
// subscribers just replace their state. A unary call in flight when the socket drops fails with Disconnected.
use std::{collections::HashMap, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest, http::HeaderValue};

use crate::{engine::Engine, net::http::SESSION_HEADER};

const BACKOFF_FIRST: Duration = Duration::from_millis(500);
const BACKOFF_MAX: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(20);

#[derive(Debug, Clone)]
pub enum RpcError {
    /// The engine answered with a failure: the encoded error (its `_tag` says which).
    Failed(Value),
    /// The engine broke (a defect) or sent something this client can't read.
    Defect(String),
    /// The socket dropped before a unary call answered.
    Disconnected,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Failed(e) => write!(f, "the engine refused: {e}"),
            Self::Defect(d) => write!(f, "engine error: {d}"),
            Self::Disconnected => write!(f, "lost the connection to the engine"),
        }
    }
}

impl std::error::Error for RpcError {}

enum Command {
    Call {
        tag: &'static str,
        payload: Option<Value>,
        reply: oneshot::Sender<Result<Value, RpcError>>,
    },
    Stream {
        tag: &'static str,
        payload: Option<Value>,
        items: mpsc::UnboundedSender<Value>,
    },
}

/// A handle to the engine's RPC; cheap to clone.
#[derive(Clone)]
pub struct Rpc {
    commands: mpsc::UnboundedSender<Command>,
}

impl Rpc {
    /// Starts the connection task on the current tokio runtime.
    pub fn connect(engine: &Engine) -> Self {
        let (commands, rx) = mpsc::unbounded_channel();
        let url = format!("{}/rpc", engine.url.replacen("http", "ws", 1));
        tokio::spawn(run(url, engine.token.clone(), rx));
        Self { commands }
    }

    /// A request with one answer.
    pub async fn call<T: DeserializeOwned>(&self, tag: &'static str, payload: Option<Value>) -> Result<T, RpcError> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(Command::Call { tag, payload, reply })
            .map_err(|_| RpcError::Disconnected)?;
        let value = answer.await.map_err(|_| RpcError::Disconnected)??;
        serde_json::from_value(value).map_err(|e| RpcError::Defect(e.to_string()))
    }

    /// A stream's items, decoded; it lives until the receiver is dropped (then the engine is told to stop). An item
    /// this client can't read is logged and skipped rather than ending the stream.
    pub fn stream<T: DeserializeOwned + Send + 'static>(
        &self,
        tag: &'static str,
        payload: Option<Value>,
    ) -> mpsc::UnboundedReceiver<T> {
        let (raw_tx, mut raw) = mpsc::unbounded_channel::<Value>();
        let (tx, rx) = mpsc::unbounded_channel();
        let _ = self.commands.send(Command::Stream {
            tag,
            payload,
            items: raw_tx,
        });
        tokio::spawn(async move {
            while let Some(value) = raw.recv().await {
                match serde_json::from_value::<T>(value) {
                    Ok(item) => {
                        if tx.send(item).is_err() {
                            break;
                        }
                    }
                    Err(e) => eprintln!("rpc {tag}: skipped an item this client can't read: {e}"),
                }
            }
        });
        rx
    }
}

struct Live {
    tag: &'static str,
    payload: Option<Value>,
    items: mpsc::UnboundedSender<Value>,
}

// The connection task: (re)connects, sends requests, routes answers, acks chunks.
async fn run(url: String, token: String, mut commands: mpsc::UnboundedReceiver<Command>) {
    let mut next_id: u64 = 0;
    let mut streams: HashMap<String, Live> = HashMap::new();
    let mut calls: HashMap<String, oneshot::Sender<Result<Value, RpcError>>> = HashMap::new();
    let mut backoff = BACKOFF_FIRST;
    loop {
        let Ok(socket) = open(&url, &token).await else {
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(BACKOFF_MAX);
            continue;
        };
        backoff = BACKOFF_FIRST;
        let (mut tx, mut rx) = socket.split();
        // Streams from before a reconnect are asked for again under new ids.
        for live in std::mem::take(&mut streams).into_values() {
            if live.items.is_closed() {
                continue;
            }
            next_id += 1;
            let id = next_id.to_string();
            if tx.send(request(&id, live.tag, &live.payload)).await.is_err() {
                break;
            }
            streams.insert(id, live);
        }
        let mut ping = tokio::time::interval(PING_EVERY);
        loop {
            tokio::select! {
                command = commands.recv() => {
                    let Some(command) = command else { return }; // every handle dropped
                    next_id += 1;
                    let id = next_id.to_string();
                    let (tag, payload) = match command {
                        Command::Call { tag, payload, reply } => { calls.insert(id.clone(), reply); (tag, payload) }
                        Command::Stream { tag, payload, items } => {
                            streams.insert(id.clone(), Live { tag, payload: payload.clone(), items });
                            (tag, payload)
                        }
                    };
                    if tx.send(request(&id, tag, &payload)).await.is_err() { break }
                }
                frame = rx.next() => {
                    let Some(Ok(frame)) = frame else { break };
                    let Message::Text(text) = frame else { continue };
                    let Ok(message) = serde_json::from_str::<Value>(&text) else { continue };
                    // The JSON serialization may batch several messages in an array.
                    let messages = match message { Value::Array(all) => all, one => vec![one] };
                    for m in messages {
                        if let Some(ack) = route(m, &mut streams, &mut calls)
                            && tx.send(ack).await.is_err() { break }
                    }
                }
                _ = ping.tick() => {
                    if tx.send(Message::text(json!({ "_tag": "Ping" }).to_string())).await.is_err() { break }
                }
            }
            // A stream whose receiver is gone: tell the engine to stop sending it.
            let gone: Vec<String> = streams
                .iter()
                .filter(|(_, l)| l.items.is_closed())
                .map(|(id, _)| id.clone())
                .collect();
            for id in gone {
                streams.remove(&id);
                let _ = tx
                    .send(Message::text(
                        json!({ "_tag": "Interrupt", "requestId": id }).to_string(),
                    ))
                    .await;
            }
        }
        for (_, reply) in calls.drain() {
            let _ = reply.send(Err(RpcError::Disconnected));
        }
        tokio::time::sleep(backoff).await;
    }
}

async fn open(
    url: &str,
    token: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tokio_tungstenite::tungstenite::Error,
> {
    let mut req = url.into_client_request()?;
    let mut secret = HeaderValue::from_str(token).expect("the secret is hex");
    secret.set_sensitive(true);
    req.headers_mut().insert(SESSION_HEADER, secret);
    Ok(tokio_tungstenite::connect_async(req).await?.0)
}

fn request(id: &str, tag: &str, payload: &Option<Value>) -> Message {
    // A Void payload is null on the wire (the engine's JSON codec refuses a missing one).
    let payload = payload.clone().unwrap_or(Value::Null);
    Message::text(json!({ "_tag": "Request", "id": id, "tag": tag, "payload": payload, "headers": [] }).to_string())
}

// One message from the engine; answers with the Ack a chunk needs.
fn route(
    m: Value,
    streams: &mut HashMap<String, Live>,
    calls: &mut HashMap<String, oneshot::Sender<Result<Value, RpcError>>>,
) -> Option<Message> {
    let id = match &m["requestId"] {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None, // Pong, or a Defect without a request
    };
    match m["_tag"].as_str()? {
        "Chunk" => {
            let live = streams.get(&id)?;
            for value in m["values"].as_array().into_iter().flatten() {
                let _ = live.items.send(value.clone());
            }
            Some(Message::text(json!({ "_tag": "Ack", "requestId": id }).to_string()))
        }
        "Exit" => {
            let exit = &m["exit"];
            let result = match exit["_tag"].as_str() {
                Some("Success") => Ok(exit["value"].clone()),
                _ => Err(failure(&exit["cause"])),
            };
            if let Some(reply) = calls.remove(&id) {
                let _ = reply.send(result);
            } else if let Some(live) = streams.remove(&id)
                && let Err(e) = result
            {
                eprintln!("rpc {}: ended: {e}", live.tag);
            }
            None
        }
        _ => None,
    }
}

fn failure(cause: &Value) -> RpcError {
    let first = cause.as_array().and_then(|c| c.first()).cloned().unwrap_or(Value::Null);
    match first["_tag"].as_str() {
        Some("Fail") => RpcError::Failed(first["error"].clone()),
        _ => RpcError::Defect(first.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chunk_is_forwarded_and_acked() {
        let (items, mut got) = mpsc::unbounded_channel();
        let mut streams = HashMap::from([(
            "7".to_string(),
            Live {
                tag: "subscribeStatus",
                payload: None,
                items,
            },
        )]);
        let ack = route(
            json!({ "_tag": "Chunk", "requestId": "7", "values": [1, 2] }),
            &mut streams,
            &mut HashMap::new(),
        );
        assert_eq!(
            ack,
            Some(Message::text(json!({ "_tag": "Ack", "requestId": "7" }).to_string()))
        );
        assert_eq!((got.try_recv().unwrap(), got.try_recv().unwrap()), (json!(1), json!(2)));
    }

    #[test]
    fn an_exit_answers_the_call_with_its_value_or_its_error() {
        let (reply, answer) = oneshot::channel();
        let mut calls = HashMap::from([("1".to_string(), reply)]);
        let exit =
            json!({ "_tag": "Exit", "requestId": "1", "exit": { "_tag": "Success", "value": { "turnId": "t" } } });
        assert!(route(exit, &mut HashMap::new(), &mut calls).is_none());
        assert_eq!(answer.blocking_recv().unwrap().unwrap(), json!({ "turnId": "t" }));

        let (reply, answer) = oneshot::channel();
        let mut calls = HashMap::from([("2".to_string(), reply)]);
        let error = json!({ "_tag": "ChatNotFound" });
        let exit = json!({ "_tag": "Exit", "requestId": 2, "exit": { "_tag": "Failure", "cause": [{ "_tag": "Fail", "error": error }] } });
        route(exit, &mut HashMap::new(), &mut calls);
        assert!(matches!(answer.blocking_recv().unwrap(), Err(RpcError::Failed(e)) if e == error));
    }
}
