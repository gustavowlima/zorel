// The chat's access level beside the model in the message box (apps/web/src/features/access-chip.tsx): what every
// agent here may do without asking. Unset, each works at its own level (its page); set, the chat's level is
// everyone's here, wider or narrower. Full access never asks, so choosing it the first time explains what that means
// and waits for an OK (remembered in the preferences). The change shows at once (optimistic); the reload corrects it.
use super::*;

use crate::{net::types::ChatAccess, state::prefs::Prefs, ui::drawer};

/// The four choices, in order: own (unset), ask, workspace, full.
const LEVELS: [Option<ChatAccess>; 4] = [
    None,
    Some(ChatAccess::Ask),
    Some(ChatAccess::Workspace),
    Some(ChatAccess::Full),
];

fn label_of(level: Option<ChatAccess>) -> String {
    match level {
        None => t!("chatAccess.own"),
        Some(ChatAccess::Ask) => t!("access.ask"),
        Some(ChatAccess::Workspace) => t!("access.workspace"),
        Some(ChatAccess::Full) => t!("access.full"),
    }
    .into_owned()
}

fn hint_of(level: Option<ChatAccess>) -> String {
    match level {
        None => t!("chatAccess.ownHint"),
        Some(ChatAccess::Ask) => t!("access.askHint"),
        Some(ChatAccess::Workspace) => t!("access.workspaceHint"),
        Some(ChatAccess::Full) => t!("access.fullHint"),
    }
    .into_owned()
}

impl ChatScreen {
    /// Sets the chat's level (None: each agent's own), at once and then on the engine.
    pub(super) fn set_access(&mut self, level: Option<ChatAccess>, cx: &mut Context<Self>) {
        let id = self.chat_id.clone();
        self.store.update(cx, |s, cx| {
            if let Some(c) = s.chats.chats.iter_mut().find(|c| c.id == id) {
                c.access = level;
            }
            cx.notify();
        });
        let http = self.store.read(cx).http.clone();
        let reload = self.store.downgrade();
        let path = format!("/api/chats/{id}");
        cx.spawn(async move |_, cx| {
            let body = json!({ "access": level.map(|l| l.to_string()) });
            if let Ok(Err(e)) =
                runtime::spawn(async move { http.patch::<_, serde_json::Value>(&path, &body).await }).await
            {
                eprintln!("access: {e}");
            }
            let _ = reload.update(cx, |s, cx| s.reload_chats(cx));
        })
        .detach();
    }

    /// Full access, the first time: what it means, and an OK.
    fn confirm_full(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, _| {
            let view = view.clone();
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("chatAccess.fullTitle").into_owned(),
                    description: Some(t!("chatAccess.fullBody").into_owned()),
                    body: None,
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("full", t!("chatAccess.fullConfirm").into_owned())
                            .variant(Variant::Destructive)
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                let mut prefs = Prefs::load();
                                prefs.full_access_confirmed = true;
                                prefs.save();
                                let _ = view.update(cx, |this, cx| this.set_access(Some(ChatAccess::Full), cx));
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }
}

/// The chip and its list of levels.
pub(super) fn chip(chat: WeakEntity<ChatScreen>, level: Option<ChatAccess>) -> AnyElement {
    let full = level == Some(ChatAccess::Full);
    let trigger = Button::new("access-chip", label_of(level))
        .icon(if full { IconName::ShieldAlert } else { IconName::Shield })
        .variant(Variant::Ghost)
        .size(Size::Sm)
        .name(t!("chatAccess.title").into_owned());
    gpui_kit::component::popover::Popover::new("access-popover")
        .anchor(Anchor::BottomLeft)
        .offset(px(6.))
        .appearance(false)
        .trigger(trigger)
        .content(move |_, window, cx| {
            let p = theme::palette(window);
            let popover = cx.entity();
            let chat = chat.clone();
            let selected = LEVELS.iter().position(|l| *l == level).unwrap_or(0);
            let pick: drawer::OnPick = Rc::new(move |ix, window, cx| {
                popover.update(cx, |s, cx| s.dismiss(window, cx));
                let next = LEVELS[ix];
                let _ = chat.update(cx, |this, cx| {
                    if next == Some(ChatAccess::Full) && !Prefs::load().full_access_confirmed {
                        this.confirm_full(window, cx);
                    } else {
                        this.set_access(next, cx);
                    }
                });
            });
            let options = LEVELS.iter().map(|l| (label_of(*l), hint_of(*l))).collect();
            crate::ui::layout::panel("access-panel", p)
                .w(px(384.))
                .flex()
                .flex_col()
                .gap(px(space::X2))
                .p(px(space::X3))
                .child(
                    div()
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM)
                        .child(t!("chatAccess.title").into_owned()),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("chatAccess.hint").into_owned()),
                )
                .child(drawer::choices("access", options, selected, pick, window, cx))
        })
        .into_any_element()
}
