// The message box (Home and the chat; prototype Inicio/Chat, apps/web/src/features/composer.tsx): a raised card with
// the text (Enter sends, Shift+Enter breaks the line, grows to 8 lines), files to attach (+, up to 10, 20 MB each),
// a tools slot (the model) and the round send button. It only collects: whoever owns it decides what sending means
// (create the chat, send, or queue) through `on_submit`, and can hand the text back when sending failed.
// ponytail: the # / @ / $ / slash menus and paste/drop of files arrive with the chat's composer pass (parity/chat.md B).
use std::{path::PathBuf, rc::Rc};

use gpui_kit::{
    assets::IconName,
    base::input::{InputEvent, Textarea, TextareaState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::ui::button::{Button, Size, Variant};
use crate::ui::icon::{self, icon};

use crate::theme::{self, tokens};

pub const MAX_FILES: usize = 10;
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// What the person sends: the text and the files chosen.
pub struct Draft {
    pub text: String,
    pub files: Vec<PathBuf>,
}

pub type OnSubmit = Rc<dyn Fn(Draft, &mut Window, &mut App) + 'static>;

/// Renders the tools slot (the model picker) each frame.
pub type Tools = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement>;

pub struct Composer {
    text: Entity<TextareaState>,
    files: Vec<PathBuf>,
    error: Option<String>,
    on_submit: OnSubmit,
    /// Beside the send button (the model picker).
    tools: Option<Tools>,
    large: bool,
    _subscription: Subscription,
}

impl Composer {
    pub fn new(
        placeholder: String,
        large: bool,
        on_submit: OnSubmit,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let text = cx.new(|cx| {
            let mut state = TextareaState::new(window, cx).placeholder(placeholder);
            state.set_auto_grow(if large { 2 } else { 1 }, 8, cx);
            state
        });
        let sub = cx.subscribe_in(&text, window, |this, _, event: &InputEvent, window, cx| {
            if let InputEvent::PressEnter { shift: false, .. } = event {
                this.submit(window, cx);
            }
        });
        Self {
            text,
            files: Vec::new(),
            error: None,
            on_submit,
            tools: None,
            large,
            _subscription: sub,
        }
    }

    pub fn set_tools(&mut self, tools: Tools) {
        self.tools = Some(tools);
    }

    /// Focus the text (Home autofocuses it).
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.text.update(cx, |t, cx| t.focus(window, cx));
    }

    /// Sending failed: the text comes back and the reason shows under the box.
    pub fn restore(&mut self, text: String, error: String, window: &mut Window, cx: &mut Context<Self>) {
        self.text.update(cx, |t, cx| t.set_value(text, window, cx));
        self.error = Some(error);
        cx.notify();
    }

    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let typed = self.text.read(cx).value().trim().to_string();
        if typed.is_empty() && self.files.is_empty() {
            return;
        }
        // Files alone still say something.
        let text = if typed.is_empty() {
            t!("composer.seeAttachments").into_owned()
        } else {
            typed
        };
        let files = std::mem::take(&mut self.files);
        self.error = None;
        self.text.update(cx, |t, cx| t.set_value("", window, cx));
        cx.notify();
        (self.on_submit)(Draft { text, files }, window, cx);
    }

    fn attach(&mut self, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: None,
        });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = picked.await else { return };
            let _ = this.update(cx, |this, cx| {
                for path in paths {
                    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if size > MAX_FILE_BYTES {
                        this.error = Some(t!("composer.tooBig", name = name).into_owned());
                    } else if this.files.len() < MAX_FILES && !this.files.contains(&path) {
                        this.files.push(path);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
}

impl Render for Composer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        let chips: Vec<AnyElement> = self
            .files
            .iter()
            .enumerate()
            .map(|(i, path)| {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .h(px(26.))
                    .pl(px(10.))
                    .pr(px(4.))
                    .rounded_full()
                    .bg(p.bg_control)
                    .text_size(px(12.5))
                    .text_color(p.text_secondary)
                    .child(icon(IconName::File, icon::XS))
                    .child(div().max_w(px(180.)).truncate().child(name.clone()))
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("remove-file-{i}")),
                            IconName::Close,
                            t!("composer.removeFile", name = name).into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.files.remove(i);
                            cx.notify();
                        })),
                    )
                    .into_any_element()
            })
            .collect();
        let tools = self.tools.clone().map(|f| f(window, cx));
        let can_send = !self.text.read(cx).value().trim().is_empty() || !self.files.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(
                div()
                    .rounded(px(tokens::RADIUS_CARD))
                    .bg(p.bg_raised)
                    .border_1()
                    .border_color(p.border_strong)
                    .shadow_lg()
                    .flex()
                    .flex_col()
                    .when(!chips.is_empty(), |c| {
                        c.child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(px(6.))
                                .px(px(12.))
                                .pt(px(10.))
                                .children(chips),
                        )
                    })
                    .child(
                        div()
                            .px(px(if self.large { 16. } else { 14. }))
                            .pt(px(if self.large { 14. } else { 12. }))
                            .text_size(px(if self.large { 15. } else { 14. }))
                            .text_color(p.text)
                            .child(Textarea::new(&self.text)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.))
                            .p(px(6.))
                            .child(
                                Button::icon_only("attach", IconName::Plus, t!("composer.attach").into_owned())
                                    .on_click(cx.listener(|this, _, _, cx| this.attach(cx))),
                            )
                            .child(div().flex_1())
                            .when_some(tools, |r, t| r.child(t))
                            .child(
                                Button::icon_only("send", IconName::ArrowUp, t!("composer.send").into_owned())
                                    .variant(Variant::Primary)
                                    .round()
                                    .disabled(!can_send)
                                    .on_click(cx.listener(|this, _, window, cx| this.submit(window, cx))),
                            ),
                    ),
            )
            .when_some(self.error.clone(), |c, e| {
                c.child(div().px(px(4.)).text_sm().text_color(p.danger).child(e))
            })
    }
}
