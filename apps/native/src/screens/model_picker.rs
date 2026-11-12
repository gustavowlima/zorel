// The model a chat runs on (apps/web/src/features/model-picker.tsx): the model id, the account (None: the provider's
// default) and the reasoning level (None: the model's default).
use crate::net::types::Agent;

pub const DEFAULT_MODEL: &str = "claude-cli/sonnet";

#[derive(Clone, Debug, PartialEq)]
pub struct ModelChoice {
    pub model: String,
    pub account_id: Option<String>,
    pub effort: Option<String>,
}

impl Default for ModelChoice {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            account_id: None,
            effort: None,
        }
    }
}

impl ModelChoice {
    /// An agent's own model, account and level.
    pub fn of(agent: &Agent) -> Self {
        Self {
            model: agent.model.clone(),
            account_id: agent.account_id.clone(),
            effort: agent.effort.map(|e| e.to_string()),
        }
    }
}
