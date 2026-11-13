// What a message of yours carries (the web's user row): images as thumbnails that open in a viewer over the chat (its
// name, Open original, close on the dimmed screen or ×), other files as chips that open in their own app. The bytes
// come from the engine (/api/attachments/:id, behind its session header), once each, then stay in memory.
use std::sync::Arc;

use super::*;

use crate::net::types::Attachment;

const THUMB_H: f32 = 112.;

impl ChatScreen {
    /// An image's picture, fetched once.
    fn picture(&mut self, a: &Attachment, cx: &mut Context<Self>) -> Remote<Arc<Image>> {
        if let Some(known) = self.images.get(&a.id) {
            return known.clone();
        }
        let Some(format) = ImageFormat::from_mime_type(&a.mime) else {
            return Remote::Failed;
        };
        self.images.insert(a.id.clone(), Remote::Loading);
        let (http, id) = (self.store.read(cx).http.clone(), a.id.clone());
        let path = format!("/api/attachments/{id}");
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move { http.bytes(&path).await }).await;
            let picture = match got {
                Ok(Ok(bytes)) => Remote::Ready(Arc::new(Image::from_bytes(format, bytes))),
                Ok(Err(e)) => {
                    eprintln!("attachment: {e}");
                    Remote::Failed
                }
                Err(_) => Remote::Failed,
            };
            let _ = this.update(cx, |this, cx| {
                this.images.insert(id, picture);
                cx.notify();
            });
        })
        .detach();
        Remote::Loading
    }

    /// Opens an attachment in the app the system picks for it (a copy in the temporary folder).
    fn open_attachment(&self, a: &Attachment, cx: &mut Context<Self>) {
        let (http, path) = (self.store.read(cx).http.clone(), format!("/api/attachments/{}", a.id));
        // Only its file name, never a path from it.
        let name = std::path::Path::new(&a.name)
            .file_name()
            .map_or_else(|| a.id.clone(), |n| n.to_string_lossy().into_owned());
        let dir = std::env::temp_dir().join("zorel-attachments").join(&a.id);
        cx.spawn(async move |_, cx| {
            let target = dir.join(name);
            let written = runtime::spawn(async move {
                let bytes = http.bytes(&path).await.map_err(|e| e.to_string())?;
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
                Ok::<_, String>(target)
            })
            .await;
            match written {
                Ok(Ok(file)) => {
                    cx.update(|cx| cx.open_with_system(&file));
                }
                Ok(Err(e)) => eprintln!("attachment: {e}"),
                Err(_) => {}
            }
        })
        .detach();
    }

    /// One attachment of a message: a thumbnail (an image) or a chip.
    pub(super) fn attachment(&mut self, a: &Attachment, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let id = SharedString::from(format!("attachment-{}", a.id));
        // An image as a thumbnail; one that couldn't be read is a chip like any file.
        let picture = self.picture(a, cx);
        if !matches!(picture, Remote::Failed) {
            let shown = a.clone();
            return div()
                .id(id)
                .h(px(THUMB_H))
                .min_w(px(THUMB_H))
                .max_w(px(240.))
                .rounded(px(tokens::RADIUS_CARD))
                .overflow_hidden()
                .border_1()
                .border_color(p.border)
                .bg(p.bg_control)
                .cursor_pointer()
                .map(|d| match picture {
                    Remote::Ready(image) => d.child(img(image).h_full().object_fit(ObjectFit::Cover)),
                    _ => d
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(Loader::new(SharedString::from(format!("thumb-{}", a.id))).size(icon::MD)),
                })
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.viewing = Some(shown.clone());
                    cx.notify();
                }))
                .into_any_element();
        }
        let file = a.clone();
        div()
            .id(id)
            .flex()
            .items_center()
            .gap(px(space::X1_5))
            .h(px(tokens::CONTROL_H_SM))
            .px(px(space::X2_5))
            .rounded_full()
            .bg(p.bg_control)
            .hover(|s| s.bg(p.bg_control_hover))
            .cursor_pointer()
            .text_size(px(12.5))
            .text_color(p.text_secondary)
            .child(icon(IconName::File, icon::XS))
            .child(div().max_w(px(200.)).truncate().child(a.name.clone()))
            .on_click(cx.listener(move |this, _, _, cx| this.open_attachment(&file, cx)))
            .into_any_element()
    }

    /// The image open over the chat, if one is.
    pub(super) fn viewer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let a = self.viewing.clone()?;
        let p = theme::palette(window);
        let picture = self.picture(&a, cx);
        let close = cx.listener(|this, _, _, cx| {
            this.viewing = None;
            cx.notify();
        });
        let close_button = cx.listener(|this, _, _, cx| {
            this.viewing = None;
            cx.notify();
        });
        let original = a.clone();
        Some(
            div()
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .id("viewer-backdrop")
                        .absolute()
                        .inset_0()
                        .bg(p.overlay)
                        .on_click(close),
                )
                .child(
                    div()
                        .relative()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(space::X2))
                        .px(px(space::X4))
                        .py(px(space::X3))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_color(p.text)
                                .child(a.name.clone()),
                        )
                        .child(
                            Button::new("viewer-open", t!("chat.openOriginal").into_owned())
                                .variant(Variant::Secondary)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| this.open_attachment(&original, cx))),
                        )
                        .child(
                            Button::icon_only("viewer-close", IconName::Close, t!("common.close").into_owned())
                                .variant(Variant::Secondary)
                                .size(Size::Sm)
                                .on_click(close_button),
                        ),
                )
                .child(
                    div()
                        .relative()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .p(px(space::X6))
                        .child(match picture {
                            Remote::Ready(image) => img(image)
                                .max_w_full()
                                .max_h_full()
                                .object_fit(ObjectFit::Contain)
                                .rounded(px(tokens::RADIUS_CARD))
                                .into_any_element(),
                            Remote::Loading => Loader::new("viewer-loading").size(icon::MD).into_any_element(),
                            Remote::Failed => div()
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(t!("common.loadFailed").into_owned())
                                .into_any_element(),
                        }),
                )
                .into_any_element(),
        )
    }

    /// A chat whose agents are all gone (archived or deleted): who continues it, picked before the next message.
    pub(super) fn who_continues(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let chat = store.chat(&self.chat_id)?;
        let teammate = |a: &crate::net::types::Agent| a.builtin.is_none() && a.archived_at.is_none();
        let orphan = !store.agents.is_empty() && !chat.agent_ids.iter().filter_map(|id| store.agent(id)).any(teammate);
        if !orphan {
            return None;
        }
        let picks: Vec<(String, String, String, usize)> =
            crate::state::crew::callable(&store.agents, chat.project_id.as_deref())
                .into_iter()
                .take(8)
                .map(|a| (a.id.clone(), a.name.clone(), a.model.clone(), store.tone(Some(&a.id))))
                .collect();
        let buttons = picks.into_iter().map(|(id, name, model, tone)| {
            let (store, chat_id) = (self.store.clone(), self.chat_id.clone());
            Button::new(SharedString::from(format!("continue-{id}")), name)
                .leading(AgentFace::new(SharedString::from(format!("continue-face-{id}")), tone).size(16.))
                .variant(Variant::Secondary)
                .size(Size::Sm)
                .on_click(move |_, _, cx| {
                    crate::screens::chat_actions::set_team(&store, &chat_id, vec![id.clone()], Some(model.clone()), cx)
                })
        });
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X2))
                .px(px(space::X3))
                .py(px(space::X2_5))
                .rounded(px(tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .bg(p.bg_surface)
                .child(
                    div().text_sm().child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(space::X1))
                            .child(
                                div()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(t!("chat.whoContinues").into_owned()),
                            )
                            .child(
                                div()
                                    .text_color(p.text_muted)
                                    .child(t!("chat.whoContinuesHint").into_owned()),
                            ),
                    ),
                )
                .child(div().flex().flex_wrap().gap(px(space::X1_5)).children(buttons))
                .into_any_element(),
        )
    }
}
