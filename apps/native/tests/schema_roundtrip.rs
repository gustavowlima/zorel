// The generated wire types read what a real engine sends (spec 019 T016): a fresh server in a temp data folder, its
// REST lists decoded with the types from packages/contracts/schema/wire.json. A field renamed or retyped in the
// contract without `bun run schema` fails here.
use std::path::PathBuf;

use zorel_native::{
    engine::{Engine, Launch},
    net::{http::Http, types},
};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

async fn fresh_engine(test: &str) -> Engine {
    let home = std::env::temp_dir().join(format!("zorel-native-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    let launch = Launch {
        home: Some(home),
        web_dir: None,
        ..Launch::dev(repo())
    };
    Engine::start(launch).await.expect("the engine starts")
}

#[tokio::test]
async fn rest_lists_decode() {
    let engine = fresh_engine("rest").await;
    let http = Http::new(&engine);
    let agents: types::AgentsListSuccess = http.get("/api/agents").await.expect("agents");
    let _: types::ProjectsListSuccess = http.get("/api/projects").await.expect("projects");
    let _: types::ChatsListSuccess = http.get("/api/chats").await.expect("chats");
    let _: types::RoutinesListSuccess = http.get("/api/routines").await.expect("routines");
    let _: types::PagesListSuccess = http.get("/api/pages").await.expect("pages");
    println!("{} agents on a fresh engine", agents.len());
}

#[tokio::test]
async fn without_the_secret_the_engine_refuses() {
    let engine = fresh_engine("secret").await;
    let status = reqwest::get(format!("{}/api/chats", engine.url))
        .await
        .expect("answers")
        .status();
    assert_eq!(status, reqwest::StatusCode::FORBIDDEN); // LocalOnly: no session secret, no /api
}
