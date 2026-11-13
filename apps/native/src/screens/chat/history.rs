// Your messages and going back: the bubble, rewinding to a message, a turn's changes and undoing them.
use super::*;

impl ChatScreen {
    /// Your message: a bubble on the right; copy and time show on hover.
    pub(super) fn user_row(&mut self, m: &Message, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let blocks = self
            .parsed
            .entry(m.id.clone())
            .or_insert_with(|| markdown::parse(&m.text));
        let text = markdown::render(&m.id, blocks, window);
        let group = SharedString::from(format!("user-{}", m.id));
        let copied = self.copied.as_deref() == Some(&m.id);
        let (id, body) = (m.id.clone(), m.text.clone());
        let attachments = m.attachments.clone();
        let files: Vec<AnyElement> = attachments.iter().map(|a| self.attachment(a, window, cx)).collect();
        div()
            .group(group.clone())
            .flex()
            .flex_col()
            .items_end()
            .gap(px(space::X1_5))
            .child(
                div()
                    .max_w(px(500.))
                    .px(px(space::X3))
                    .py(px(space::X2_5))
                    .rounded_tl(px(tokens::RADIUS_CARD))
                    .rounded_tr(px(tokens::RADIUS_CARD))
                    .rounded_bl(px(tokens::RADIUS_CARD))
                    .rounded_br(px(space::X1_5))
                    .bg(p.bg_raised)
                    .border_1()
                    .border_color(p.border)
                    .child(text),
            )
            .when(!m.attachments.is_empty(), |c| {
                c.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .justify_end()
                        .gap(px(space::X1_5))
                        .children(files),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X1))
                    .opacity(0.)
                    .group_hover(group, |s| s.opacity(1.))
                    .child(div().text_xs().text_color(p.text_dim).child(format::time(
                        m.at,
                        format::now_ms(),
                        format::lang(),
                    )))
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("copy-{}", m.id)),
                            if copied { IconName::Check } else { IconName::Copy },
                            if copied { t!("common.copied") } else { t!("common.copy") }.into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, _, cx| this.copy(id.clone(), body.clone(), cx))),
                    )
                    // Not while a reply runs: the engine can't go back under a live turn.
                    .when(!self.busy(), |r| {
                        let message = m.clone();
                        r.child(
                            Button::icon_only(
                                SharedString::from(format!("rewind-{}", m.id)),
                                IconName::Pencil,
                                t!("chat.editFromHere").into_owned(),
                            )
                            .size(Size::Xs)
                            .on_click(cx.listener(move |this, _, window, cx| this.ask_rewind(&message, window, cx))),
                        )
                    }),
            )
            .into_any_element()
    }

    /// "Edit from here": this message and everything after leave the conversation and the message comes back to the
    /// box; when later turns changed files, a switch also takes those changes back (on by default, as the web).
    pub(super) fn ask_rewind(&mut self, message: &Message, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let changes = self
            .log
            .messages
            .iter()
            .any(|m| m.at >= message.at && !m.changes.is_empty() && m.reverted_at.is_none());
        let files = Rc::new(std::cell::Cell::new(true));
        let error: Rc<std::cell::RefCell<Option<String>>> = Rc::default();
        let (view, id, at) = (cx.entity().downgrade(), message.id.clone(), message.at);
        window.open_dialog(cx, move |dialog, window, cx| {
            let p = theme::palette(window);
            let mut body: Vec<AnyElement> = Vec::new();
            if changes {
                let files = files.clone();
                body.push(crate::ui::switch::switch(
                    "rewind-files",
                    t!("chat.rewindFiles").into_owned(),
                    files.get(),
                    Rc::new(move |on, window, _| {
                        files.set(on);
                        window.refresh();
                    }),
                    window,
                    cx,
                ));
            }
            if let Some(e) = error.borrow().clone() {
                body.push(div().text_sm().text_color(p.danger).child(e).into_any_element());
            }
            let (view, id, files, error) = (view.clone(), id.clone(), files.clone(), error.clone());
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("chat.rewindTitle").into_owned(),
                    description: Some(t!("chat.rewindBody").into_owned()),
                    body: (!body.is_empty()).then(|| {
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X3))
                            .children(body)
                            .into_any_element()
                    }),
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("rewind", t!("chat.rewindAction").into_owned())
                            .variant(Variant::Primary)
                            .on_click(move |_, window, cx| {
                                let files = changes && files.get();
                                let (view, id, error) = (view.clone(), id.clone(), error.clone());
                                let Some(this) = view.upgrade() else { return };
                                let (http, chat_id) =
                                    (this.read(cx).store.read(cx).http.clone(), this.read(cx).chat_id.clone());
                                window
                                    .spawn(cx, async move |cx| {
                                        let path = format!("/api/chats/{chat_id}/rewind");
                                        let body = json!({ "messageId": id, "files": files });
                                        let done = runtime::spawn(async move {
                                            http.post::<_, serde_json::Value>(&path, &body).await
                                        })
                                        .await;
                                        let _ = cx.update(|window, cx| match done {
                                            Ok(Ok(v)) => {
                                                let text = v["text"].as_str().unwrap_or_default().to_string();
                                                window.close_dialog(cx);
                                                let _ = view.update(cx, |this, cx| this.rewound(at, text, window, cx));
                                            }
                                            Ok(Err(e)) => {
                                                *error.borrow_mut() = Some(match conflict_files(&e) {
                                                    Some(f) => t!("workspace.undoConflict", files = f).into_owned(),
                                                    None => t!("chat.rewindFailed").into_owned(),
                                                });
                                                window.refresh();
                                            }
                                            Err(_) => {
                                                *error.borrow_mut() = Some(t!("chat.rewindFailed").into_owned());
                                                window.refresh();
                                            }
                                        });
                                    })
                                    .detach();
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }

    /// The engine went back: the messages from `at` on leave the timeline and the text returns to the box.
    pub(super) fn rewound(&mut self, at: f64, text: String, window: &mut Window, cx: &mut Context<Self>) {
        self.log.messages.retain(|m| m.at < at);
        self.log.revision += 1;
        self.composer.update(cx, |c, cx| c.set_text(text, window, cx));
        self.relayout(cx);
        cx.notify();
    }

    /// The files a turn changed: how many and how much (+added −removed), and Undo (confirmed) or "Undone".
    pub(super) fn turn_changes(
        &mut self,
        m: &Message,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let turn = m.turn_id.clone().filter(|_| !m.changes.is_empty())?;
        let p = theme::palette(window);
        let added: f64 = m.changes.iter().map(|c| c.added).sum();
        let removed: f64 = m.changes.iter().map(|c| c.removed).sum();
        let error = self.undo_errors.get(&turn).cloned();
        let row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(space::X2))
            .self_start()
            .px(px(space::X3))
            .py(px(space::X1))
            .rounded(px(tokens::RADIUS_CARD))
            .border_1()
            .border_color(p.border)
            .text_sm()
            .child(icon(IconName::File, icon::XS).text_color(p.text_muted))
            .child(
                div()
                    .text_color(p.text_secondary)
                    .child(tn("workspace.filesChanged", m.changes.len() as i64)),
            )
            .child(div().text_color(p.success).child(format!("+{added:.0}")))
            .child(div().text_color(p.danger).child(format!("−{removed:.0}")))
            .map(|r| {
                if m.reverted_at.is_some() {
                    r.child(
                        div()
                            .text_color(p.text_muted)
                            .child(format!("· {}", t!("workspace.undone"))),
                    )
                } else {
                    let (turn, view) = (turn.clone(), turn.clone());
                    r.child(
                        Button::new(
                            SharedString::from(format!("view-{turn}")),
                            t!("workspace.viewDiff").into_owned(),
                        )
                        .variant(Variant::Ghost)
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, _, cx| this.view_turn(view.clone(), cx))),
                    )
                    .child(
                        Button::new(
                            SharedString::from(format!("undo-{turn}")),
                            t!("workspace.undo").into_owned(),
                        )
                        .variant(Variant::Ghost)
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, window, cx| this.ask_undo(turn.clone(), window, cx))),
                    )
                }
            });
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X1_5))
                .child(row)
                .when_some(error, |c, e| c.child(div().text_sm().text_color(p.danger).child(e)))
                .into_any_element(),
        )
    }

    /// Undo a turn's file changes, after a confirmation: marked undone at once, put back if the engine refuses.
    pub(super) fn ask_undo(&mut self, turn: String, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, _| {
            let (view, turn) = (view.clone(), turn.clone());
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("workspace.undoTitle").into_owned(),
                    description: Some(t!("workspace.undoBody").into_owned()),
                    body: None,
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("undo", t!("workspace.undo").into_owned())
                            .variant(Variant::Destructive)
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                let _ = view.update(cx, |this, cx| this.undo(turn.clone(), cx));
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }

    pub(super) fn undo(&mut self, turn: String, cx: &mut Context<Self>) {
        mark_reverted(&mut self.log, &turn, Some(format::now_ms()));
        self.undo_errors.remove(&turn);
        cx.notify();
        let http = self.store.read(cx).http.clone();
        let path = format!("/api/turns/{turn}/undo");
        cx.spawn(async move |this, cx| {
            let done = runtime::spawn(async move { http.post::<_, serde_json::Value>(&path, &json!({})).await }).await;
            let failed = match done {
                Ok(Ok(_)) => return,
                Ok(Err(e)) => conflict_files(&e).map(|f| t!("workspace.undoConflict", files = f).into_owned()),
                Err(_) => None,
            };
            let _ = this.update(cx, |this, cx| {
                mark_reverted(&mut this.log, &turn, None);
                this.undo_errors.insert(
                    turn.clone(),
                    failed.unwrap_or_else(|| t!("workspace.undoFailed").into_owned()),
                );
                cx.notify();
            });
        })
        .detach();
    }
}

/// The files an engine conflict names (`{"files": [...]}` in its 409 body), joined for a message.
fn conflict_files(e: &crate::net::http::HttpError) -> Option<String> {
    let crate::net::http::HttpError::Status(_, body) = e else {
        return None;
    };
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let files: Vec<&str> = v["files"].as_array()?.iter().filter_map(|f| f.as_str()).collect();
    (!files.is_empty()).then(|| files.join(", "))
}

/// Marks (or unmarks) the messages of a turn as undone.
fn mark_reverted(log: &mut ChatLog, turn: &str, at: Option<f64>) {
    for m in log.messages.iter_mut().filter(|m| m.turn_id.as_deref() == Some(turn)) {
        m.reverted_at = at;
    }
    log.revision += 1;
}
