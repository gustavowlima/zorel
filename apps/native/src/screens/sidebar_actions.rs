// The sidebar's row actions (parity/sidebar.md › Context menu): a chat can be opened, renamed (≤80 characters,
// trimmed, not empty) or deleted; a project can be opened, get a new chat, or be deleted; "+" on Projects adds one.
// Each mutation goes to the engine and the Store reloads; deleting what is open goes home. The right-click menu and
// the ⋯ button share one builder.
// ponytail: a new project is created without a folder until the folder picker lands (T045).
use std::rc::Rc;

use gpui_kit::{
    component::{
        WindowExt as _,
        input::{Input, InputState},
    },
    *,
};
use rust_i18n::t;

use crate::ui::button::{Button, Variant};
use serde_json::json;

use crate::{
    route::Route,
    runtime,
    screens::sidebar::{Sidebar, SidebarEvent},
    ui::{menu::Menu, nav::MenuBuilder},
};

const TITLE_MAX: usize = 80;

impl Sidebar {
    pub(super) fn chat_menu(view: &Entity<Self>, id: String, title: String) -> MenuBuilder {
        let view = view.clone();
        Rc::new(move || {
            let (open, rename, delete) = (view.clone(), view.clone(), view.clone());
            let (id1, id2, id3, title) = (id.clone(), id.clone(), id.clone(), title.clone());
            Menu::default()
                .item(t!("common.open").into_owned(), move |_, cx| {
                    open.update(cx, |_, cx| {
                        cx.emit(SidebarEvent::Navigate(Route::Chat { id: id1.clone() }))
                    })
                })
                .item(t!("common.rename").into_owned(), move |window, cx| {
                    Self::rename_chat(&rename, id2.clone(), title.clone(), window, cx)
                })
                .separator()
                .danger(t!("common.delete").into_owned(), move |window, cx| {
                    Self::delete_chat(&delete, id3.clone(), window, cx)
                })
                .build()
        })
    }

    pub(super) fn project_menu(view: &Entity<Self>, id: String, name: String) -> MenuBuilder {
        let view = view.clone();
        Rc::new(move || {
            let (open, delete) = (view.clone(), view.clone());
            let (id1, id2, name1, name2) = (id.clone(), id.clone(), name.clone(), name.clone());
            Menu::default()
                .item(t!("nav.newChatIn", name = name1).into_owned(), move |_, cx| {
                    open.update(cx, |_, cx| {
                        cx.emit(SidebarEvent::Navigate(Route::Home {
                            project_id: Some(id1.clone()),
                        }))
                    })
                })
                .separator()
                .danger(t!("project.deleteAction").into_owned(), move |window, cx| {
                    Self::delete_project(&delete, id2.clone(), name2.clone(), window, cx)
                })
                .build()
        })
    }

    fn rename_chat(view: &Entity<Self>, id: String, title: String, window: &mut Window, cx: &mut App) {
        let input = cx.new(|cx| InputState::new(window, cx).default_value(title));
        let focus = std::cell::Cell::new(true);
        let view = view.clone();
        window.open_dialog(cx, move |dialog, window, cx| {
            if focus.replace(false) {
                input.focus_handle(cx).focus(window, cx);
            }
            let (save_input, view, id) = (input.clone(), view.clone(), id.clone());
            dialog
                .title(t!("chat.renameTitle").into_owned())
                .child(Input::new(&input))
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("cancel", t!("common.cancel").into_owned())
                                .on_click(|_, window, cx| window.close_dialog(cx)),
                        )
                        .child(
                            Button::new("save", t!("common.save").into_owned())
                                .variant(Variant::Primary)
                                .on_click(move |_, window, cx| {
                                    let title: String =
                                        save_input.read(cx).value().trim().chars().take(TITLE_MAX).collect();
                                    if title.is_empty() {
                                        return;
                                    }
                                    window.close_dialog(cx);
                                    let (store, path) = (view.read(cx).store.clone(), format!("/api/chats/{id}"));
                                    let http = store.read(cx).http.clone();
                                    let reload = store.downgrade();
                                    cx.spawn(async move |cx| {
                                        let done = runtime::spawn(async move {
                                            http.patch::<_, serde_json::Value>(&path, &json!({ "title": title }))
                                                .await
                                        })
                                        .await;
                                        if let Ok(Err(e)) = &done {
                                            eprintln!("rename: {e}");
                                        }
                                        let _ = reload.update(cx, |store, cx| store.reload_chats(cx));
                                    })
                                    .detach();
                                }),
                        ),
                )
        });
    }

    fn delete_chat(view: &Entity<Self>, id: String, window: &mut Window, cx: &mut App) {
        let view = view.clone();
        window.open_dialog(cx, move |dialog, _, _| {
            let (view, id) = (view.clone(), id.clone());
            dialog
                .title(t!("chat.deleteTitle").into_owned())
                .child(t!("chat.deleteBody").into_owned())
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("cancel", t!("common.cancel").into_owned())
                                .on_click(|_, window, cx| window.close_dialog(cx)),
                        )
                        .child(
                            Button::new("delete", t!("common.delete").into_owned())
                                .variant(Variant::Destructive)
                                .on_click(move |_, window, cx| {
                                    window.close_dialog(cx);
                                    let open = view.read(cx).route == (Route::Chat { id: id.clone() });
                                    if open {
                                        view.update(cx, |_, cx| cx.emit(SidebarEvent::Navigate(Route::default())));
                                    }
                                    Self::engine_then_reload(&view, format!("/api/chats/{id}"), cx);
                                }),
                        ),
                )
        });
    }

    fn delete_project(view: &Entity<Self>, id: String, name: String, window: &mut Window, cx: &mut App) {
        let view = view.clone();
        window.open_dialog(cx, move |dialog, _, _| {
            let (view, id) = (view.clone(), id.clone());
            dialog
                .title(t!("project.deleteTitle", name = name).into_owned())
                .child(t!("project.deleteBody").into_owned())
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("cancel", t!("common.cancel").into_owned())
                                .on_click(|_, window, cx| window.close_dialog(cx)),
                        )
                        .child(
                            Button::new("delete", t!("project.deleteAction").into_owned())
                                .variant(Variant::Destructive)
                                .on_click(move |_, window, cx| {
                                    window.close_dialog(cx);
                                    let inside = view.read(cx).route
                                        == (Route::Home {
                                            project_id: Some(id.clone()),
                                        });
                                    if inside {
                                        view.update(cx, |_, cx| cx.emit(SidebarEvent::Navigate(Route::default())));
                                    }
                                    Self::engine_then_reload(&view, format!("/api/projects/{id}"), cx);
                                }),
                        ),
                )
        });
    }

    pub(super) fn new_project(view: &Entity<Self>, window: &mut Window, cx: &mut App) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(t!("project.name").into_owned()));
        let focus = std::cell::Cell::new(true);
        let view = view.clone();
        window.open_dialog(cx, move |dialog, window, cx| {
            if focus.replace(false) {
                input.focus_handle(cx).focus(window, cx);
            }
            let (name_input, view) = (input.clone(), view.clone());
            dialog
                .title(t!("project.addTitle").into_owned())
                .child(Input::new(&input))
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("cancel", t!("common.cancel").into_owned())
                                .on_click(|_, window, cx| window.close_dialog(cx)),
                        )
                        .child(
                            Button::new("add", t!("project.add").into_owned())
                                .variant(Variant::Primary)
                                .on_click(move |_, window, cx| {
                                    let name = name_input.read(cx).value().trim().to_string();
                                    if name.is_empty() {
                                        return;
                                    }
                                    window.close_dialog(cx);
                                    let store = view.read(cx).store.clone();
                                    let http = store.read(cx).http.clone();
                                    let (reload, nav) = (store.downgrade(), view.downgrade());
                                    cx.spawn(async move |cx| {
                                        let made = runtime::spawn(async move {
                                            http.post::<_, serde_json::Value>(
                                                "/api/projects",
                                                &json!({ "name": name, "brief": "", "path": null }),
                                            )
                                            .await
                                        })
                                        .await;
                                        let _ = reload.update(cx, |store, cx| store.load(cx));
                                        match made {
                                            Ok(Ok(project)) => {
                                                let id = project["id"].as_str().map(str::to_string);
                                                let _ = nav.update(cx, |_, cx| {
                                                    cx.emit(SidebarEvent::Navigate(Route::Home { project_id: id }))
                                                });
                                            }
                                            Ok(Err(e)) => eprintln!("new project: {e}"),
                                            Err(e) => eprintln!("new project: {e}"),
                                        }
                                    })
                                    .detach();
                                }),
                        ),
                )
        });
    }

    // A DELETE to the engine, then the Store reloads everything (a project takes its chats, agents and memories).
    fn engine_then_reload(view: &Entity<Self>, path: String, cx: &mut App) {
        let store = view.read(cx).store.clone();
        let http = store.read(cx).http.clone();
        let reload = store.downgrade();
        cx.spawn(async move |cx| {
            if let Ok(Err(e)) = runtime::spawn(async move { http.delete(&path).await }).await {
                eprintln!("delete: {e}");
            }
            let _ = reload.update(cx, |store, cx| store.load(cx));
        })
        .detach();
    }
}
