// Who a new chat starts with (apps/web/src/features/agent-options.ts): the agents that can be called here, a
// project's crew, the agent used last, and who a message names with "@handle" (they join the chat before it is sent).
// Works on ids and names so the rules are tested without whole agents.
use crate::net::types::{Agent, AgentTeam, Chat};

/// A chat holds 8 agents (NewChat/ChatPatch agentIds).
pub const CHAT_MEMBERS_MAX: usize = 8;

/// Agents that can be called in a project: not built in, not archived, global or this project's.
pub fn callable<'a>(agents: &'a [Agent], project_id: Option<&str>) -> Vec<&'a Agent> {
    agents
        .iter()
        .filter(|a| a.builtin.is_none() && a.archived_at.is_none())
        .filter(|a| a.project_id.is_none() || a.project_id.as_deref() == project_id)
        .collect()
}

/// Teams in reach of a project: global or its own.
pub fn teams_in<'a>(teams: &'a [AgentTeam], project_id: Option<&str>) -> Vec<&'a AgentTeam> {
    teams
        .iter()
        .filter(|t| t.project_id.is_none() || t.project_id.as_deref() == project_id)
        .collect()
}

/// A project's crew: its agents, then its teams' members, once each, only those callable, up to what a chat holds.
pub fn project_crew(
    agent_ids: &[String],
    team_ids: &[String],
    teams: &[(&str, &[String])],
    callable: &[&str],
) -> Vec<String> {
    let from_teams = team_ids
        .iter()
        .filter_map(|id| teams.iter().find(|(t, _)| t == id))
        .flat_map(|(_, members)| members.iter());
    let mut out: Vec<String> = Vec::new();
    for id in agent_ids.iter().chain(from_teams) {
        if callable.contains(&id.as_str()) && !out.contains(id) {
            out.push(id.clone());
        }
    }
    out.truncate(CHAT_MEMBERS_MAX);
    out
}

/// The agent used last: the first callable agent of the most recent chat that has one, else the first callable.
pub fn last_used(chats: &[&Chat], callable: &[&str]) -> Option<String> {
    let mut recent: Vec<&&Chat> = chats.iter().collect();
    recent.sort_by(|a, b| {
        b.last_at
            .unwrap_or(b.created_at)
            .total_cmp(&a.last_at.unwrap_or(a.created_at))
    });
    recent
        .iter()
        .flat_map(|c| c.agent_ids.iter())
        .find(|id| callable.contains(&id.as_str()))
        .cloned()
        .or_else(|| callable.first().map(|s| s.to_string()))
}

/// How a message names an agent or a team: its name without accents, lowercased, runs of other characters as "-".
pub fn handle_of(name: &str) -> String {
    let plain = handle_key(name);
    let mut out = String::new();
    for c in plain.chars() {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// A handle as typed, compared without accents and case.
fn handle_key(s: &str) -> String {
    // ponytail: strips the combining marks of decomposed Latin letters (á → a) by a fixed table; a full NFD
    // (icu_normalizer) if names in other scripts need it.
    s.chars().map(fold_accent).collect::<String>().to_lowercase()
}

fn fold_accent(c: char) -> char {
    const FROM: &str = "ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñÝýÿ";
    const TO: &str = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy";
    FROM.chars()
        .position(|f| f == c)
        .and_then(|i| TO.chars().nth(i))
        .unwrap_or(c)
}

/// The "@handle"s a message names, in order (contracts MENTION_RE), leaving out code in backticks.
pub fn mentions(text: &str) -> Vec<String> {
    let prose = strip_code(text);
    let chars: Vec<char> = prose.chars().collect();
    let mut out = Vec::new();
    let word = |c: char| c.is_alphanumeric() || c == '_' || c == '-';
    for (i, &c) in chars.iter().enumerate() {
        let after_word = i > 0 && (chars[i - 1].is_alphanumeric() || matches!(chars[i - 1], '_' | '.' | '-'));
        if c != '@' || after_word || !chars.get(i + 1).is_some_and(|c| c.is_alphanumeric()) {
            continue;
        }
        let handle: String = chars[i + 1..].iter().take_while(|c| word(**c)).collect();
        out.push(handle);
    }
    out
}

fn strip_code(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('`') {
        out.push_str(&rest[..start]);
        let fence = rest[start..].starts_with("```");
        let open = if fence { 3 } else { 1 };
        let close = if fence { "```" } else { "`" };
        match rest[start + open..].find(close) {
            Some(end) => {
                out.push(' ');
                rest = &rest[start + open + end + close.len()..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Who a message names that must join the chat first: callable agents (by handle) and teams' callable members, not
/// members yet, once each, in the order named.
pub fn to_join(text: &str, members: &[String], callable: &[(&str, &str)], teams: &[(&str, &[String])]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for handle in mentions(text) {
        let key = handle_key(&handle);
        let named: Vec<&str> = match callable.iter().find(|(_, name)| handle_of(name) == key) {
            Some((id, _)) => vec![*id],
            None => teams
                .iter()
                .find(|(name, _)| handle_of(name) == key)
                .map(|(_, ids)| {
                    ids.iter()
                        .map(String::as_str)
                        .filter(|id| callable.iter().any(|(c, _)| c == id))
                        .collect()
                })
                .unwrap_or_default(),
        };
        for id in named {
            if !members.iter().any(|m| m == id) && !out.iter().any(|o| o == id) {
                out.push(id.to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn handles_drop_accents_and_join_words() {
        assert_eq!(handle_of("Atlas"), "atlas");
        assert_eq!(handle_of("Revisão de Código!"), "revisao-de-codigo");
    }

    #[test]
    fn mentions_skip_code_and_emails() {
        assert_eq!(
            mentions("@atlas look `@nova` and gus@mail.com, ```@x``` @Órion"),
            ["atlas", "Órion"]
        );
    }

    #[test]
    fn a_crew_is_agents_then_team_members_once_and_callable() {
        let team = ids(&["b", "c", "z"]);
        let teams = [("t1", team.as_slice())];
        let crew = project_crew(&ids(&["a", "b"]), &ids(&["t1"]), &teams, &["a", "b", "c"]);
        assert_eq!(crew, ["a", "b", "c"]);
    }

    #[test]
    fn named_agents_and_teams_join_once() {
        let callable = [("a1", "Atlas"), ("n1", "Nova"), ("r1", "Rosa")];
        let team = ids(&["n1", "r1", "gone"]);
        let teams = [("Reviewers", team.as_slice())];
        let joined = to_join("@nova and @reviewers, @atlas", &ids(&["a1"]), &callable, &teams);
        assert_eq!(joined, ["n1", "r1"]);
    }
}
