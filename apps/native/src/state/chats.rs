// The chat list and every chat's status (spec 019 T022): the chats from REST, statuses from the subscribeStatus
// stream. A status for a chat this list doesn't know means it was created elsewhere: the caller refetches the list.
use std::collections::HashMap;

use crate::net::types::{Chat, ChatStatus};

#[derive(Default)]
pub struct ChatList {
    pub chats: Vec<Chat>,
    pub statuses: HashMap<String, ChatStatus>,
}

impl ChatList {
    /// Records a status; true when the chat is unknown (time to refetch the list).
    pub fn apply_status(&mut self, status: ChatStatus) -> bool {
        let unknown = !self.chats.iter().any(|c| c.id == status.chat_id);
        self.statuses.insert(status.chat_id.clone(), status);
        unknown
    }

    /// Top-level chats (tasks live under their parent chat), most recent first.
    pub fn visible(&self) -> impl Iterator<Item = &Chat> {
        let mut chats: Vec<&Chat> = self.chats.iter().filter(|c| c.parent_id.is_none()).collect();
        chats.sort_by(|a, b| b.created_at.total_cmp(&a.created_at));
        chats.into_iter()
    }
}
