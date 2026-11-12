// Labels the screens share (apps/web/src/labels.ts): a chat's title, what a chat's status says.
use rust_i18n::t;

use crate::{
    format,
    net::types::{AgentWait, Chat, ChatStatus, ChatStatusState},
    state::store::Store,
};

/// A chat's title; the default "New chat" (stored in either language) shows in the person's language.
pub fn chat_title(chat: &Chat) -> String {
    match chat.title.as_str() {
        "" | "New chat" | "Novo chat" => t!("chat.untitled").into_owned(),
        title => title.to_string(),
    }
}

/// "Ana is working", "Ana and Rex are working", "Ana waits for your OK", "Ana asks you something", "The last turn
/// failed", or who waits for whom; empty when there is nothing to say.
pub fn status_label(status: &ChatStatus, store: &Store) -> String {
    let agent = store.agent_name(status.agent_id.as_deref());
    match status.state {
        ChatStatusState::Running if status.agent_ids.len() > 1 => {
            let names: Vec<String> = status.agent_ids.iter().map(|id| store.agent_name(Some(id))).collect();
            t!("status.runningMany", agents = format::list(&names, format::lang())).into_owned()
        }
        ChatStatusState::Running => t!("status.running", agent = agent).into_owned(),
        ChatStatusState::Waiting if status.label == "question" => t!("status.asking", agent = agent).into_owned(),
        ChatStatusState::Waiting => t!("status.waiting", agent = agent).into_owned(),
        ChatStatusState::Failed => t!("status.failed").into_owned(),
        ChatStatusState::Idle => status.waits.first().map(|w| wait_label(w, store)).unwrap_or_default(),
    }
}

/// "Leo waits for Iris" / "Leo waits for Iris and Nico".
pub fn wait_label(wait: &AgentWait, store: &Store) -> String {
    let others: Vec<String> = wait.on.iter().map(|id| store.agent_name(Some(id))).collect();
    t!(
        "status.waitsFor",
        agent = store.agent_name(Some(&wait.agent_id)),
        other = format::list(&others, format::lang())
    )
    .into_owned()
}
