// Labels the screens share (apps/web/src/labels.ts): a chat's title, what a chat's status says.
use rust_i18n::t;

use crate::{
    format,
    net::types::{AgentWait, Chat, ChatStatus, ChatStatusState, ModelInfo},
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

// ---------- usage windows (labels.ts windowLabel / windowMinutes / paceOf) ----------

/// A window at 80% or more is flagged before it runs out (packages/contracts LIMIT_ALERT).
pub const LIMIT_ALERT: f64 = 0.8;

const NAMED_WINDOWS: [&str; 5] = [
    "five_hour",
    "seven_day",
    "seven_day_opus",
    "seven_day_sonnet",
    "seven_day_oauth_apps",
];

/// "5-hour", "Weekly", "Gemini · 5-hour", "3-day"…
pub fn window_label(id: &str) -> String {
    if NAMED_WINDOWS.contains(&id) {
        return t!(format!("usage.windows.{id}")).into_owned();
    }
    if let Some(model) = id.strip_prefix("model:") {
        return model.to_string();
    }
    if let Some((len, group)) = id.split_once(':').filter(|(len, _)| len.ends_with('m')) {
        return format!("{group} · {}", window_label(len));
    }
    match id.strip_suffix('m').and_then(|m| m.parse::<f64>().ok()) {
        Some(m) if m % 1440. == 0. => t!("usage.windows.days", count = (m / 1440.) as i64).into_owned(),
        Some(m) => t!("usage.windows.hours", count = (m / 60.).round() as i64).into_owned(),
        None => id.to_string(),
    }
}

/// How long a window lasts in minutes (None for one scoped to a model).
pub fn window_minutes(id: &str) -> Option<f64> {
    if id.starts_with("model:") {
        return None;
    }
    let named = match id {
        "five_hour" => Some(300.),
        "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "seven_day_oauth_apps" => Some(10_080.),
        _ => None,
    };
    named.or_else(|| {
        id.split(':')
            .next()
            .and_then(|l| l.strip_suffix('m'))
            .and_then(|m| m.parse().ok())
    })
}

/// How a limit window is going: used (0..1) and, when the burn so far would empty it before it resets, roughly when.
pub struct Pace {
    pub used: f64,
    pub runs_out_at: Option<f64>,
    /// For sorting: above 1 when it runs out early (the earlier, the higher), else `used`.
    pub risk: f64,
}

pub fn pace_of(id: &str, used_percent: f64, resets_at: Option<f64>, now: f64) -> Pace {
    let used = used_percent / 100.;
    let (Some(minutes), Some(resets)) = (window_minutes(id), resets_at) else {
        return Pace {
            used,
            runs_out_at: None,
            risk: used,
        };
    };
    let length = minutes * 60_000.;
    let start = resets - length;
    let elapsed = ((now - start) / length).clamp(0., 1.);
    let out = (used > 0. && elapsed >= 0.1).then(|| start + (now - start) / used);
    let runs_out_at = out.filter(|o| *o < resets);
    let risk = runs_out_at.map_or(used, |o| 1. + (resets - o) / length);
    Pace {
        used,
        runs_out_at,
        risk,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tone {
    Ok,
    Warning,
    Critical,
}

pub fn tone_of(pace: &Pace) -> Tone {
    match pace {
        p if p.used >= 0.95 => Tone::Critical,
        p if p.runs_out_at.is_some() || p.used >= LIMIT_ALERT => Tone::Warning,
        _ => Tone::Ok,
    }
}

/// "claude-cli/opus" → ("claude-cli", "opus").
pub fn split_model(id: &str) -> (&str, &str) {
    id.split_once('/').unwrap_or((id, ""))
}

/// "Claude Code", "OpenRouter"; an unknown provider keeps its id.
pub fn provider_label(provider: &str) -> String {
    const KNOWN: [&str; 10] = [
        "claude-cli",
        "codex-cli",
        "gemini-cli",
        "opencode",
        "antigravity",
        "anthropic",
        "openai",
        "openrouter",
        "ollama",
        "lmstudio",
    ];
    if KNOWN.contains(&provider) {
        t!(format!("model.providers.{provider}")).into_owned()
    } else {
        provider.to_string()
    }
}

/// A model's name: what the engine calls it today ("Opus 5.5"), else read from the id ("claude-sonnet-5-5" →
/// "Sonnet 5.5", "claude-cli/opus" → "Opus", "…/default" → "CLI default"); API models keep their id.
pub fn model_name(id: &str, models: &[ModelInfo]) -> String {
    if let Some(name) = models.iter().find(|m| m.id == id).and_then(|m| m.name.clone()) {
        return name;
    }
    let (provider, model) = split_model(id);
    if model == "default" {
        return t!("model.cliDefault").into_owned();
    }
    let parts: Vec<&str> = model.split('-').collect();
    if let ["claude", family @ ("opus" | "sonnet" | "haiku"), major, minor, ..] = parts.as_slice()
        && major.chars().all(|c| c.is_ascii_digit())
        && minor.chars().take_while(|c| c.is_ascii_digit()).count() > 0
    {
        let minor: String = minor.chars().take_while(|c| c.is_ascii_digit()).collect();
        return format!("{} {major}.{minor}", capitalize(family));
    }
    if matches!(provider, "claude-cli" | "codex-cli") {
        return capitalize(model);
    }
    model.to_string()
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{Tone, model_name, pace_of, split_model, tone_of, window_minutes};

    #[test]
    fn model_names_read_from_ids() {
        assert_eq!(split_model("openrouter/x/y"), ("openrouter", "x/y"));
        assert_eq!(model_name("anthropic/claude-sonnet-5-5-20261001", &[]), "Sonnet 5.5");
        assert_eq!(model_name("claude-cli/opus", &[]), "Opus");
        assert_eq!(model_name("openai/gpt-x", &[]), "gpt-x");
    }

    #[test]
    fn windows_and_pace() {
        assert_eq!(window_minutes("five_hour"), Some(300.));
        assert_eq!(window_minutes("300m:Gemini"), Some(300.));
        assert_eq!(window_minutes("model:opus"), None);
        // Half the window gone, 80% used: it runs out before it resets.
        let length = 300. * 60_000.;
        let pace = pace_of("five_hour", 80., Some(length), length / 2.);
        assert!(pace.runs_out_at.is_some() && pace.risk > 1.);
        assert_eq!(tone_of(&pace), Tone::Warning);
        assert_eq!(tone_of(&pace_of("model:x", 96., None, 0.)), Tone::Critical);
    }
}
