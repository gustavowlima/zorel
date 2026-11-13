// Sending: the composer's menus' sources, what you submit (now, or queued while a reply runs), Send now, Stop,
// Try again and the chat's model.
use super::*;

impl ChatScreen {
    /// What the composer's menus offer here: the chat's people and teams, the skills in its reach, the commands.
    pub(super) fn sources(
        chat_id: &str,
        store: &Entity<Store>,
        commands: Rc<std::cell::RefCell<Vec<crate::net::types::EngineCommand>>>,
        view: WeakEntity<Self>,
    ) -> crate::screens::composer::Sources {
        use crate::screens::composer::{Mark, MenuOption, Trigger};
        let (chat_id, store) = (chat_id.to_string(), store.clone());
        Rc::new(move |trigger, cx| {
            let s = store.read(cx);
            let Some(chat) = s.chat(&chat_id) else {
                return Vec::new();
            };
            match trigger {
                Trigger::Lead | Trigger::Mention => {
                    crate::screens::mentions::people(s, chat.project_id.as_deref(), Some(&chat.agent_ids))
                }
                Trigger::Skill => {
                    let mut scopes = vec!["user".to_string()];
                    scopes.extend(chat.project_id.as_ref().map(|p| format!("project:{p}")));
                    scopes.extend(chat.agent_ids.iter().map(|a| format!("agent:{a}")));
                    crate::screens::mentions::skills(s, &scopes)
                }
                Trigger::Command => {
                    let project = chat.project_id.clone();
                    let (compact, fresh) = (view.clone(), view.clone());
                    let mut out = vec![
                        MenuOption {
                            id: "compact".into(),
                            label: t!("composer.command.compact").into_owned(),
                            hint: Some(t!("composer.command.compactHint").into_owned()),
                            mark: Mark::Icon(IconName::Minimize2),
                            run: Some(Rc::new(move |_, cx| {
                                let _ = compact.update(cx, |this, cx| this.compact(cx));
                            })),
                        },
                        MenuOption {
                            id: "new".into(),
                            label: t!("composer.command.newChat").into_owned(),
                            hint: Some(t!("composer.command.newChatHint").into_owned()),
                            mark: Mark::Icon(IconName::SquarePen),
                            run: Some(Rc::new(move |_, cx| {
                                let project_id = project.clone();
                                let _ = fresh.update(cx, |_, cx| {
                                    cx.emit(ChatEvent::Navigate(crate::route::Route::Home { project_id }))
                                });
                            })),
                        },
                    ];
                    out.extend(commands.borrow().iter().map(|c| MenuOption {
                        id: c.name.clone(),
                        label: match &c.argument_hint {
                            Some(h) => format!("/{} {h}", c.name),
                            None => format!("/{}", c.name),
                        },
                        hint: Some(c.description.clone()),
                        mark: Mark::Icon(IconName::SquareTerminal),
                        run: None,
                    }));
                    out
                }
            }
        })
    }

    /// Folds the older messages into the chat's summary (the /compact command).
    pub(super) fn compact(&mut self, cx: &mut Context<Self>) {
        let view = cx.entity().downgrade();
        let store = self.store.read(cx);
        let (http, path) = (store.http.clone(), format!("/api/chats/{}/consolidate", self.chat_id));
        let reload = self.store.downgrade();
        cx.spawn(async move |_, cx| {
            if let Ok(Err(e)) =
                runtime::spawn(async move { http.post::<_, serde_json::Value>(&path, &json!({})).await }).await
            {
                eprintln!("compact: {e}");
            }
            let _ = reload.update(cx, |s, cx| s.reload_chats(cx));
            let _ = view.update(cx, |this, cx| this.load_context(cx));
        })
        .detach();
    }

    /// Who the text names that isn't in the chat yet: they join it before the message goes (a chat holds 8).
    pub(super) fn joining(&self, text: &str, cx: &App) -> Option<Vec<String>> {
        let store = self.store.read(cx);
        let chat = store.chat(&self.chat_id)?;
        let callable = crate::state::crew::callable(&store.agents, chat.project_id.as_deref());
        let pairs: Vec<(&str, &str)> = callable.iter().map(|a| (a.id.as_str(), a.name.as_str())).collect();
        let teams: Vec<(&str, &[String])> = crate::state::crew::teams_in(&store.teams, chat.project_id.as_deref())
            .into_iter()
            .map(|t| (t.name.as_str(), t.agent_ids.as_slice()))
            .collect();
        let mut named = crate::state::crew::to_join(text, &chat.agent_ids, &pairs, &teams);
        named.truncate(crate::state::crew::CHAT_MEMBERS_MAX.saturating_sub(chat.agent_ids.len()));
        (!named.is_empty()).then(|| chat.agent_ids.iter().cloned().chain(named).collect())
    }

    pub(super) fn submit(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        // With the Builder's proposal out, what you write asks for a change: the proposal is declined with your words
        // (its turn waits on that decision; a plain message would queue behind it, unread).
        if let Some(id) = self.proposal().map(|a| a.id.clone()) {
            self.store
                .update(cx, |s, cx| s.decide(id, "denied", Some(draft.text), cx));
            return;
        }
        if self.busy() || !self.queue.is_empty() {
            self.queue.push(draft); // sent when the chat is free
            cx.notify();
            return;
        }
        self.deliver(draft, window, cx);
    }

    /// Sends a message: first adds the agents it @mentions to the chat, then delivers it. Resolves to why it failed.
    pub(super) fn send(&self, draft: Draft, cx: &App) -> impl std::future::Future<Output = Result<(), String>> + use<> {
        let store = self.store.read(cx);
        let (http, rpc, chat_id) = (store.http.clone(), self.rpc.clone(), self.chat_id.clone());
        let join = self.joining(&draft.text, cx);
        let task = runtime::spawn(async move {
            if let Some(agent_ids) = join {
                http.patch::<_, serde_json::Value>(&format!("/api/chats/{chat_id}"), &json!({ "agentIds": agent_ids }))
                    .await
                    .map_err(|_| t!("chat.addFailed").into_owned())?;
            }
            crate::net::send::deliver(&http, &rpc, &chat_id, &draft.text, draft.files).await
        });
        async move { task.await.unwrap_or_else(|_| Err(t!("chat.sendFailed").into_owned())) }
    }

    /// Sends what was typed; failed, the text goes back in the box with why.
    pub(super) fn deliver(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        let typed = draft.text.clone();
        let sent = self.send(draft, cx);
        cx.spawn_in(window, async move |this, cx| {
            let failed = sent.await.err();
            let _ = this.update_in(cx, |this, window, cx| match failed {
                Some(msg) => this.composer.update(cx, |c, cx| c.restore(typed, msg, window, cx)),
                None => this.store.update(cx, |s, cx| s.reload_chats(cx)), // someone may have joined
            });
        })
        .detach();
    }

    /// The chat is free: the next queued message goes, one at a time. Failed, it stays at the queue's front.
    pub(super) fn drain(&mut self, cx: &mut Context<Self>) {
        if self.draining || self.busy() || self.queue.is_empty() {
            return;
        }
        self.draining = true;
        let draft = self.queue.remove(0);
        let sent = self.send(draft.clone(), cx);
        cx.spawn(async move |this, cx| {
            let result = sent.await;
            let _ = this.update(cx, |this, cx| {
                this.draining = false;
                match result {
                    Ok(()) => this.store.update(cx, |s, cx| s.reload_chats(cx)),
                    Err(e) => {
                        eprintln!("queue: {e}");
                        this.queue.insert(0, draft);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// "Send now": the queued message leaves the queue and joins the reply in progress (Claude, Codex, no files) or
    /// stops it and goes as a turn of its own; a short note says which. Refused, it goes back to the queue's front.
    pub(super) fn send_now(&mut self, n: usize, cx: &mut Context<Self>) {
        if n >= self.queue.len() {
            return;
        }
        let draft = self.queue.remove(n);
        cx.notify();
        let store = self.store.read(cx);
        let (http, rpc, chat_id) = (store.http.clone(), self.rpc.clone(), self.chat_id.clone());
        let (text, files) = (draft.text.clone(), draft.files.clone());
        let task = runtime::spawn(async move { crate::net::send::steer(&http, &rpc, &chat_id, &text, files).await });
        cx.spawn(async move |this, cx| {
            let done = task.await;
            let _ = this.update(cx, |this, cx| {
                match done {
                    Ok(Ok(joined)) => {
                        this.sent = Some(if joined {
                            "queue.sentJoined"
                        } else {
                            "queue.sentStopped"
                        });
                        // The note says what happened for a few seconds.
                        cx.spawn(async move |this, cx| {
                            cx.background_executor().timer(Duration::from_secs(6)).await;
                            let _ = this.update(cx, |this, cx| {
                                this.sent = None;
                                cx.notify();
                            });
                        })
                        .detach();
                    }
                    _ => this.queue.insert(0, draft),
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Whether "Send now" joins the running reply (its engine takes messages mid-reply, and nothing is attached).
    pub(super) fn joins_turn(&self, draft: &Draft, cx: &App) -> bool {
        let model = self
            .log
            .turns
            .first()
            .map(|t| t.model.clone())
            .or_else(|| self.store.read(cx).chat(&self.chat_id).map(|c| c.model.clone()))
            .unwrap_or_default();
        let (provider, _) = crate::labels::split_model(&model);
        draft.files.is_empty() && ["claude-cli", "codex-cli"].contains(&provider)
    }

    pub(super) fn stop(&mut self, cx: &mut Context<Self>) {
        let (rpc, chat_id) = (self.rpc.clone(), self.chat_id.clone());
        self.queue.clear();
        cx.notify();
        runtime::spawn(async move {
            if let Err(e) = rpc
                .call::<serde_json::Value>("interrupt", Some(json!({ "chatId": chat_id })))
                .await
            {
                eprintln!("interrupt: {e}");
            }
        });
    }

    pub(super) fn retry(&mut self, message_id: String) {
        let (rpc, chat_id) = (self.rpc.clone(), self.chat_id.clone());
        runtime::spawn(async move {
            if let Err(e) = rpc
                .call::<serde_json::Value>("retry", Some(json!({ "chatId": chat_id, "messageId": message_id })))
                .await
            {
                eprintln!("retry: {e}");
            }
        });
    }

    pub(super) fn set_model(&mut self, choice: ModelChoice, cx: &mut Context<Self>) {
        let id = self.chat_id.clone();
        self.store.update(cx, |s, cx| {
            if let Some(c) = s.chats.chats.iter_mut().find(|c| c.id == id) {
                c.model = choice.model.clone();
                c.account_id = choice.account_id.clone();
            }
            cx.notify();
        });
        let store = self.store.read(cx);
        let (http, path) = (store.http.clone(), format!("/api/chats/{}", self.chat_id));
        let reload = self.store.downgrade();
        let body = json!({ "model": choice.model, "accountId": choice.account_id, "effort": choice.effort });
        cx.spawn(async move |_, cx| {
            if let Ok(Err(e)) =
                runtime::spawn(async move { http.patch::<_, serde_json::Value>(&path, &body).await }).await
            {
                eprintln!("model: {e}");
            }
            let _ = reload.update(cx, |s, cx| s.reload_chats(cx));
        })
        .detach();
    }
}
