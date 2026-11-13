// Sending a message into a chat (Home's new chat and the chat screen): upload the files first (raw bytes, the name in
// `x-file-name`), then RPC `send` with their ids and a client id for idempotency. Errors are the sentences the
// composer shows under the box.
use std::path::{Path, PathBuf};

use rust_i18n::t;
use serde_json::json;

use crate::net::{http::Http, rpc::Rpc, types::Attachment};

pub async fn deliver(http: &Http, rpc: &Rpc, chat_id: &str, text: &str, files: Vec<PathBuf>) -> Result<(), String> {
    let attachment_ids = upload_all(http, chat_id, files).await?;
    let mut payload = json!({ "chatId": chat_id, "clientId": format!("native-{}", client_id()), "text": text });
    if !attachment_ids.is_empty() {
        payload["attachmentIds"] = json!(attachment_ids);
    }
    rpc.call::<serde_json::Value>("send", Some(payload))
        .await
        .map(|_| ())
        .map_err(|_| t!("chat.sendFailed").into_owned())
}

/// "Send now" from the queue: into the reply in progress when its engine takes it (true), else that reply stops and
/// this is a turn of its own (false).
pub async fn steer(http: &Http, rpc: &Rpc, chat_id: &str, text: &str, files: Vec<PathBuf>) -> Result<bool, String> {
    let attachment_ids = upload_all(http, chat_id, files).await?;
    let mut payload = json!({ "chatId": chat_id, "text": text });
    if !attachment_ids.is_empty() {
        payload["attachmentIds"] = json!(attachment_ids);
    }
    rpc.call::<serde_json::Value>("steer", Some(payload))
        .await
        .map(|v| v["joined"].as_bool().unwrap_or(false))
        .map_err(|_| t!("chat.sendFailed").into_owned())
}

/// Uploads the files a message carries; their attachment ids.
async fn upload_all(http: &Http, chat_id: &str, files: Vec<PathBuf>) -> Result<Vec<String>, String> {
    let mut attachment_ids = Vec::new();
    for path in files {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let failed = || t!("composer.uploadFailed", name = name).into_owned();
        let bytes = std::fs::read(&path).map_err(|_| failed())?;
        let attachment: Attachment = http
            .upload(
                &format!("/api/chats/{chat_id}/attachments"),
                &name,
                mime_of(&path),
                bytes,
            )
            .await
            .map_err(|_| failed())?;
        attachment_ids.push(attachment.id);
    }
    Ok(attachment_ids)
}

/// A file's media type by its extension (the engine stores it with the attachment).
pub fn mime_of(path: &Path) -> &'static str {
    const TYPES: [(&str, &str); 12] = [
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("gif", "image/gif"),
        ("webp", "image/webp"),
        ("svg", "image/svg+xml"),
        ("pdf", "application/pdf"),
        ("txt", "text/plain"),
        ("md", "text/markdown"),
        ("csv", "text/csv"),
        ("json", "application/json"),
        ("html", "text/html"),
    ];
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    TYPES
        .iter()
        .find(|(e, _)| *e == ext)
        .map_or("application/octet-stream", |(_, m)| m)
}

/// A client id for `send` (idempotency): 16 random bytes as hex.
pub fn client_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the system's random source");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
