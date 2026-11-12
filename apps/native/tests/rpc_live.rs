// The RPC client against a real engine (spec 019 T020): Effect's envelope (request, chunk + ack, exit, failure) as the
// engine actually speaks it, and the chat events decoding with the generated types. A fresh engine has no provider
// account, so the turn that `send` starts ends in turn-failed: that is still the whole event path.
use std::{path::PathBuf, time::Duration};

use serde_json::json;
use zorel_native::{
    engine::{Engine, Launch},
    net::{
        http::Http,
        rpc::{Rpc, RpcError},
        types::{self, SubscribeChatItem},
    },
};

async fn fresh_engine(test: &str) -> Engine {
    let home = std::env::temp_dir().join(format!("zorel-native-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    Engine::start(Launch {
        home: Some(home),
        web_dir: None,
        ..Launch::dev(repo)
    })
    .await
    .expect("the engine starts")
}

async fn next<T>(rx: &mut tokio::sync::mpsc::UnboundedReceiver<T>) -> T {
    tokio::time::timeout(Duration::from_secs(20), rx.recv())
        .await
        .expect("an item in time")
        .expect("the stream is open")
}

#[tokio::test]
async fn a_chat_streams_its_snapshot_then_the_turn() {
    let engine = fresh_engine("rpc").await;
    let http = Http::new(&engine);
    let agent: types::AgentsCreateSuccess = http
        .post("/api/agents", &json!({ "projectId": null, "name": "Tester", "instructions": "Test.", "model": "anthropic/claude-sonnet-4-5" }))
        .await
        .expect("an agent");
    let chat: types::ChatsCreateSuccess = http
        .post(
            "/api/chats",
            &json!({ "projectId": null, "agentIds": [agent.id], "model": "anthropic/claude-sonnet-4-5" }),
        )
        .await
        .expect("a chat");

    let rpc = Rpc::connect(&engine);
    let mut events = rpc.stream::<SubscribeChatItem>("subscribeChat", Some(json!({ "chatId": chat.id })));
    assert!(
        matches!(next(&mut events).await, SubscribeChatItem::Snapshot { .. }),
        "a stream starts with a snapshot"
    );

    let sent: types::SendSuccess = rpc
        .call(
            "send",
            Some(json!({ "chatId": chat.id, "clientId": "native-test-1", "text": "hello" })),
        )
        .await
        .expect("send answers");
    let mut seen = Vec::new();
    loop {
        let event = next(&mut events).await;
        let done = matches!(
            event,
            SubscribeChatItem::TurnCompleted { .. } | SubscribeChatItem::TurnFailed { .. }
        );
        seen.push(
            format!("{event:?}")
                .split([' ', '{', '('])
                .next()
                .unwrap_or_default()
                .to_string(),
        );
        if done {
            break;
        }
    }
    assert!(
        seen.iter().any(|e| e == "TurnStarted"),
        "the turn {} started: {seen:?}",
        sent.turn_id
    );
}

#[tokio::test]
async fn a_failure_comes_back_as_the_contract_error() {
    let engine = fresh_engine("rpc-error").await;
    let rpc = Rpc::connect(&engine);
    let answer = rpc
        .call::<serde_json::Value>("decide", Some(json!({ "approvalId": "nope", "outcome": "denied" })))
        .await;
    assert!(
        matches!(answer, Err(RpcError::Failed(ref e)) if e["_tag"] == "ApprovalNotFound"),
        "{answer:?}"
    );
}

#[tokio::test]
async fn the_status_stream_and_a_void_payload_work() {
    let engine = fresh_engine("rpc-void").await;
    let rpc = Rpc::connect(&engine);
    let approvals: types::ApprovalsSuccess = rpc.call("approvals", None).await.expect("approvals answers");
    assert!(approvals.is_empty());
    let _status = rpc.stream::<types::SubscribeStatusItem>("subscribeStatus", None);
}
