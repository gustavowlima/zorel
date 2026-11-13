// What can be done to a chat from anywhere (its header, the sidebar's row menu): rename it (≤80 characters, trimmed,
// not empty), delete it (confirmed), change who is in it. Each change shows at once in the Store; the engine's answer
// and the reload that follows correct it if it failed.
use std::rc::Rc;

use gpui_kit::{
    component::{
        WindowExt as _,
        input::{Input, InputState},
    },
    *,
};
use rust_i18n::t;
use serde_json::json;

use crate::{
    runtime,
    state::store::Store,
    ui::{
        button::{Button, Variant},
        dialog::{Sheet, Width, field, sheet},
    },
};

const TITLE_MAX: usize = 80;

/// Runs after a chat is deleted (the screen moves away if it was open).
pub type AfterDelete = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

/// The title a rename saves: trimmed, at most 80 characters; None when nothing is left.
pub fn clean_title(raw: &str) -> Option<String> {
    let title: String = raw.trim().chars().take(TITLE_MAX).collect();
    let title = title.trim_end().to_string();
    (!title.is_empty()).then_some(title)
}

/// Asks for a new title and saves it.
pub fn rename(store: Entity<Store>, id: String, title: String, window: &mut Window, cx: &mut App) {
    let input = cx.new(|cx| InputState::new(window, cx).default_value(title));
    let focus = std::cell::Cell::new(true);
    window.open_dialog(cx, move |dialog, window, cx| {
        if focus.replace(false) {
            input.focus_handle(cx).focus(window, cx);
        }
        let (save_input, store, id) = (input.clone(), store.clone(), id.clone());
        sheet(
            dialog,
            window,
            Width::Sm,
            Sheet {
                title: t!("chat.renameTitle").into_owned(),
                description: None,
                body: Some(field(window, Input::new(&input).appearance(false)).into_any_element()),
                actions: vec![
                    Button::new("cancel", t!("common.cancel").into_owned())
                        .on_click(|_, window, cx| window.close_dialog(cx))
                        .into_any_element(),
                    Button::new("save", t!("common.save").into_owned())
                        .variant(Variant::Primary)
                        .on_click(move |_, window, cx| {
                            let Some(title) = clean_title(save_input.read(cx).value().as_ref()) else {
                                return;
                            };
                            window.close_dialog(cx);
                            store.update(cx, |s, cx| {
                                if let Some(c) = s.chats.chats.iter_mut().find(|c| c.id == id) {
                                    c.title = title.clone();
                                }
                                cx.notify();
                            });
                            patch(&store, &id, json!({ "title": title }), cx);
                        })
                        .into_any_element(),
                ],
            },
        )
    });
}

/// Confirms, then deletes the chat (it leaves the list at once).
pub fn delete(store: Entity<Store>, id: String, after: AfterDelete, window: &mut Window, cx: &mut App) {
    window.open_dialog(cx, move |dialog, window, _| {
        let (store, id, after) = (store.clone(), id.clone(), after.clone());
        sheet(
            dialog,
            window,
            Width::Sm,
            Sheet {
                title: t!("chat.deleteTitle").into_owned(),
                description: Some(t!("chat.deleteBody").into_owned()),
                body: None,
                actions: vec![
                    Button::new("cancel", t!("common.cancel").into_owned())
                        .on_click(|_, window, cx| window.close_dialog(cx))
                        .into_any_element(),
                    Button::new("delete", t!("common.delete").into_owned())
                        .variant(Variant::Destructive)
                        .on_click(move |_, window, cx| {
                            window.close_dialog(cx);
                            after(window, cx);
                            store.update(cx, |s, cx| {
                                s.chats.chats.retain(|c| c.id != id);
                                s.chats.statuses.remove(&id);
                                cx.notify();
                            });
                            let http = store.read(cx).http.clone();
                            let (reload, path) = (store.downgrade(), format!("/api/chats/{id}"));
                            cx.spawn(async move |cx| {
                                if let Ok(Err(e)) = runtime::spawn(async move { http.delete(&path).await }).await {
                                    eprintln!("delete: {e}");
                                }
                                let _ = reload.update(cx, |store, cx| store.load(cx));
                            })
                            .detach();
                        })
                        .into_any_element(),
                ],
            },
        )
    });
}

/// Who is in the chat (the first leads); `model` when the chat follows a new lead's model.
pub fn set_team(store: &Entity<Store>, id: &str, agent_ids: Vec<String>, model: Option<String>, cx: &mut App) {
    store.update(cx, |s, cx| {
        if let Some(c) = s.chats.chats.iter_mut().find(|c| c.id == id) {
            c.agent_ids = agent_ids.clone();
            if let Some(m) = &model {
                c.model = m.clone();
            }
        }
        cx.notify();
    });
    let mut body = json!({ "agentIds": agent_ids });
    if let Some(m) = model {
        body["model"] = json!(m);
    }
    patch(store, id, body, cx);
}

fn patch(store: &Entity<Store>, id: &str, body: serde_json::Value, cx: &mut App) {
    let http = store.read(cx).http.clone();
    let (reload, path) = (store.downgrade(), format!("/api/chats/{id}"));
    cx.spawn(async move |cx| {
        let done = runtime::spawn(async move { http.patch::<_, serde_json::Value>(&path, &body).await }).await;
        if let Ok(Err(e)) = &done {
            eprintln!("chat update: {e}");
        }
        let _ = reload.update(cx, |store, cx| store.reload_chats(cx));
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::clean_title;

    #[test]
    fn a_title_is_trimmed_capped_and_never_empty() {
        assert_eq!(clean_title("  Plan  ").as_deref(), Some("Plan"));
        assert_eq!(clean_title("   "), None);
        assert_eq!(clean_title(&"a".repeat(100)).map(|t| t.chars().count()), Some(80));
    }
}
