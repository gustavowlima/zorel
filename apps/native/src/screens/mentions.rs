// What the composer's menus offer (apps/web/src/features/chat.tsx sources): the agents a chat can call, its members
// first (their title or model on the side) and then the others ("Add to chat": they join when the message is sent),
// then the teams; and the skills in the chat's reach. Shared by Home (everyone is a candidate) and the chat.
use gpui_kit::assets::IconName;
use rust_i18n::t;

use crate::{
    labels::{model_name, provider_label, split_model},
    net::types::{MemoryKind, MemoryState},
    screens::composer::{Mark, MenuOption},
    state::{
        crew::{self, handle_of},
        store::Store,
    },
};

/// Agents (members first) and teams, for # and @. `members`: the chat's agents (None on Home: no one is outside).
pub fn people(store: &Store, project_id: Option<&str>, members: Option<&[String]>) -> Vec<MenuOption> {
    let callable = crew::callable(&store.agents, project_id);
    let is_member = |id: &str| members.is_none_or(|m| m.iter().any(|x| x == id));
    let mut ordered: Vec<_> = callable.iter().filter(|a| is_member(&a.id)).collect();
    if let Some(members) = members {
        ordered.sort_by_key(|a| members.iter().position(|m| *m == a.id).unwrap_or(usize::MAX));
    }
    let outside = callable.iter().filter(|a| !is_member(&a.id));
    let mut out: Vec<MenuOption> = ordered
        .into_iter()
        .map(|a| MenuOption {
            id: handle_of(&a.name),
            label: a.name.clone(),
            hint: Some(if a.title.is_empty() {
                let (provider, _) = split_model(&a.model);
                format!("{} · {}", provider_label(provider), model_name(&a.model, &store.models))
            } else {
                a.title.clone()
            }),
            mark: Mark::Face(store.tone(Some(&a.id))),
            run: None,
        })
        .chain(outside.map(|a| MenuOption {
            id: handle_of(&a.name),
            label: a.name.clone(),
            hint: Some(t!("composer.addToChat").into_owned()),
            mark: Mark::Face(store.tone(Some(&a.id))),
            run: None,
        }))
        .collect();
    out.extend(
        crew::teams_in(&store.teams, project_id)
            .into_iter()
            .map(|team| MenuOption {
                id: team.handle.clone(),
                label: team.name.clone(),
                hint: Some(t!("teams.option", count = team.agent_ids.len()).into_owned()),
                mark: Mark::Icon(IconName::Users),
                run: None,
            }),
    );
    out
}

/// Active skills in reach of these scopes (the person, the project, the chat's agents), for $.
pub fn skills(store: &Store, scopes: &[String]) -> Vec<MenuOption> {
    store
        .memories
        .iter()
        .filter(|m| matches!(m.kind, MemoryKind::Skill) && matches!(m.state, MemoryState::Active))
        .filter(|m| scopes.contains(&m.scope))
        .map(|m| MenuOption {
            id: handle_of(&m.title),
            label: m.title.clone(),
            hint: None,
            mark: Mark::Icon(IconName::Sparkles),
            run: None,
        })
        .collect()
}
