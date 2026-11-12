// The sidebar (spec 019 T031): every top-level chat with its agent's face and state, in the web's order
// (apps/web/src/features/sidebar-order.ts): whose turn it is first (waiting for you, then working), then chats never
// placed by hand by latest activity, then the placed ones in their manual order.
use gpui_kit::*;
use rust_i18n::t;

use crate::{
    net::types::{Chat, ChatStatus, ChatStatusState},
    state::chats::ChatList,
    ui::{
        face::{AgentFace, FaceState},
        nav::NavRow,
    },
};

/// Waiting for you, then working, then the rest.
fn rank(status: Option<&ChatStatus>) -> u8 {
    match status.map(|s| &s.state) {
        Some(ChatStatusState::Waiting) => 0,
        Some(ChatStatusState::Running) => 1,
        _ => 2,
    }
}

fn last_activity(chat: &Chat, status: Option<&ChatStatus>) -> f64 {
    chat.created_at
        .max(chat.last_at.unwrap_or(0.))
        .max(status.map(|s| s.updated_at).unwrap_or(0.))
}

/// The chats in sidebar order.
pub fn ordered(list: &ChatList) -> Vec<&Chat> {
    let status = |c: &Chat| list.statuses.get(&c.id);
    let (mut free, mut placed): (Vec<&Chat>, Vec<&Chat>) = list.visible().partition(|c| c.position.is_none());
    free.sort_by(|a, b| last_activity(b, status(b)).total_cmp(&last_activity(a, status(a))));
    placed.sort_by(|a, b| a.position.unwrap_or(0.).total_cmp(&b.position.unwrap_or(0.)));
    let mut chats: Vec<&Chat> = free.into_iter().chain(placed).collect();
    chats.sort_by_key(|c| rank(status(c))); // stable: keeps the order above within each rank
    chats
}

pub fn face_state(status: Option<&ChatStatus>) -> FaceState {
    match status.map(|s| &s.state) {
        Some(ChatStatusState::Running) => FaceState::Working,
        Some(ChatStatusState::Waiting) => FaceState::Waiting,
        Some(ChatStatusState::Failed) => FaceState::Failed,
        _ => FaceState::Idle,
    }
}

/// One sidebar row: the chat's agent face (with its state) and title.
pub fn row(chat: &Chat, status: Option<&ChatStatus>, tone: usize, active: bool) -> NavRow {
    let title = if chat.title.is_empty() {
        t!("chat.untitled").into_owned()
    } else {
        chat.title.clone()
    };
    NavRow::new(SharedString::from(format!("chat-{}", chat.id)), title)
        .leading(
            AgentFace::new(SharedString::from(format!("side-face-{}", chat.id)), tone)
                .size(18.)
                .state(face_state(status)),
        )
        .active(active)
}

#[cfg(test)]
mod tests {
    use super::{ChatList, ordered};
    use crate::net::types::{Chat, ChatStatus};

    fn chat(id: &str, created: f64, position: Option<f64>) -> Chat {
        serde_json::from_value(
            serde_json::json!({ "id": id, "title": id, "createdAt": created, "position": position,
            "lastAt": null, "parentId": null, "projectId": null, "agentIds": [], "model": "a/b", "accountId": null,
            "effort": null, "access": null, "failover": null, "agentWorktrees": {}, "learnedUntil": 0, "preview": null,
            "resumeAt": null, "summary": "", "summaryUntil": 0, "worktree": null }),
        )
        .expect("a chat")
    }

    #[test]
    fn whose_turn_first_then_recent_then_placed() {
        let mut list = ChatList {
            chats: vec![
                chat("old", 1., None),
                chat("new", 5., None),
                chat("pinned", 0., Some(1.)),
                chat("asks", 0., None),
            ],
            ..Default::default()
        };
        let waiting: ChatStatus =
            serde_json::from_value(serde_json::json!({ "chatId": "asks", "state": "waiting", "label": "",
            "unread": false, "updatedAt": 0, "agentId": null, "agentIds": [], "waits": [] }))
            .expect("a status");
        list.apply_status(waiting);
        let ids: Vec<&str> = ordered(&list).iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["asks", "new", "old", "pinned"]);
    }
}
