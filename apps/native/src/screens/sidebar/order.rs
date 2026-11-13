// The order the sidebar lists chats in: whose turn first, then recent activity, then where you placed them; a task
// waiting lifts onto its parent.
use super::*;

/// Waiting for you, then working, then the rest.
pub(super) fn rank(status: Option<&ChatStatus>) -> u8 {
    match status.map(|s| s.state) {
        Some(ChatStatusState::Waiting) => 0,
        Some(ChatStatusState::Running) => 1,
        _ => 2,
    }
}

pub(super) fn same_set(a: &[String], b: &[String]) -> bool {
    a.len() == b.len() && a.iter().all(|id| b.contains(id))
}

pub(super) fn last_activity(chat: &Chat, status: Option<&ChatStatus>) -> f64 {
    chat.created_at
        .max(chat.last_at.unwrap_or(0.))
        .max(status.map(|s| s.updated_at).unwrap_or(0.))
}

/// One group's chats in sidebar order (apps/web/src/features/sidebar-order.ts).
pub fn ordered<'a>(mut chats: Vec<&'a Chat>, statuses: &HashMap<String, ChatStatus>) -> Vec<&'a Chat> {
    let status = |c: &Chat| statuses.get(&c.id);
    let (mut free, mut placed): (Vec<&Chat>, Vec<&Chat>) = chats.drain(..).partition(|c| c.position.is_none());
    free.sort_by(|a, b| last_activity(b, status(b)).total_cmp(&last_activity(a, status(a))));
    placed.sort_by(|a, b| a.position.unwrap_or(0.).total_cmp(&b.position.unwrap_or(0.)));
    let mut out: Vec<&Chat> = free.into_iter().chain(placed).collect();
    out.sort_by_key(|c| rank(status(c))); // stable: keeps the order above within each rank
    out
}

/// Each chat's status with a task's "waiting for you" lifted onto its parent (the task itself isn't listed).
pub fn lifted(chats: &[Chat], statuses: &HashMap<String, ChatStatus>) -> HashMap<String, ChatStatus> {
    let mut out = statuses.clone();
    for child in chats.iter().filter(|c| c.parent_id.is_some()) {
        let waiting = statuses
            .get(&child.id)
            .is_some_and(|s| s.state == ChatStatusState::Waiting);
        if let (true, Some(parent)) = (waiting, &child.parent_id)
            && let Some(child_status) = statuses.get(&child.id)
        {
            let entry = out.entry(parent.clone()).or_insert_with(|| child_status.clone());
            if entry.state != ChatStatusState::Waiting {
                *entry = ChatStatus {
                    chat_id: parent.clone(),
                    ..child_status.clone()
                };
            }
        }
    }
    out
}

pub fn face_state(status: Option<&ChatStatus>) -> FaceState {
    match status.map(|s| s.state) {
        Some(ChatStatusState::Running) => FaceState::Working,
        Some(ChatStatusState::Waiting) => FaceState::Waiting,
        Some(ChatStatusState::Failed) => FaceState::Failed,
        _ => FaceState::Idle,
    }
}

/// Removes `key` from the set, or adds it when it wasn't there.
pub(super) fn flip(set: &mut std::collections::BTreeSet<String>, key: &str) {
    if !set.remove(key) {
        set.insert(key.to_string());
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{lifted, ordered};
    use crate::net::types::{Chat, ChatStatus, ChatStatusState};

    fn chat(id: &str, created: f64, position: Option<f64>, parent: Option<&str>) -> Chat {
        serde_json::from_value(
            serde_json::json!({ "id": id, "title": id, "createdAt": created, "position": position,
            "lastAt": null, "parentId": parent, "projectId": null, "agentIds": [], "model": "a/b", "accountId": null,
            "effort": null, "access": null, "failover": null, "agentWorktrees": {}, "learnedUntil": 0, "preview": null,
            "resumeAt": null, "summary": "", "summaryUntil": 0, "worktree": null }),
        )
        .expect("a chat")
    }

    fn status(chat: &str, state: &str) -> ChatStatus {
        serde_json::from_value(
            serde_json::json!({ "chatId": chat, "state": state, "label": "", "unread": false,
            "updatedAt": 0, "agentId": null, "agentIds": [], "waits": [] }),
        )
        .expect("a status")
    }

    #[test]
    fn whose_turn_first_then_recent_then_placed() {
        let chats = [
            chat("old", 1., None, None),
            chat("new", 5., None, None),
            chat("pinned", 0., Some(1.), None),
            chat("asks", 0., None, None),
        ];
        let statuses = HashMap::from([("asks".to_string(), status("asks", "waiting"))]);
        let ids: Vec<&str> = ordered(chats.iter().collect(), &statuses)
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, ["asks", "new", "old", "pinned"]);
    }

    #[test]
    fn a_task_waiting_lifts_onto_its_parent() {
        let chats = [chat("parent", 1., None, None), chat("task", 2., None, Some("parent"))];
        let statuses = HashMap::from([("task".to_string(), status("task", "waiting"))]);
        assert_eq!(lifted(&chats, &statuses)["parent"].state, ChatStatusState::Waiting);
    }
}
