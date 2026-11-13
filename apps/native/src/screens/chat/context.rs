// The context meter beside the model in the message box (apps/web/src/features/context-meter.tsx): a 20px ring with
// how full the next turn's context is (the warning tone from 80%), opening a popover with the parts Zorel puts in it
// (instructions, memories, skills, summary, messages) against the model's window, the free room, what the last reply
// read, when Zorel compacts on its own, and two ways out: compact now or start a new chat. The server estimates the
// numbers from the turn it would send (~4 characters a token); the screen reads them on open and after each turn.
use super::*;

use crate::net::types::{ContextUsage, ContextUsagePartsItemId as Part};

const ALERT: f64 = 0.8;

impl ChatScreen {
    /// Reads the chat's context usage again.
    pub(super) fn load_context(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        let path = format!("/api/chats/{}/context", self.chat_id);
        cx.spawn(async move |this, cx| {
            match runtime::spawn(async move { http.get::<ContextUsage>(&path).await }).await {
                Ok(Ok(usage)) => {
                    let _ = this.update(cx, |this, cx| {
                        this.context = Some(usage);
                        cx.notify();
                    });
                }
                Ok(Err(e)) => eprintln!("context: {e}"),
                Err(_) => {}
            }
        })
        .detach();
    }
}

fn color_of(part: Part, p: &Palette) -> Rgba {
    match part {
        Part::Instructions => p.series_1,
        Part::Memories => p.series_3,
        Part::Skills => p.series_7,
        Part::Summary => p.series_4,
        Part::Messages => p.text_secondary,
    }
}

fn key_of(part: Part) -> &'static str {
    match part {
        Part::Instructions => "context.parts.instructions",
        Part::Memories => "context.parts.memories",
        Part::Skills => "context.parts.skills",
        Part::Summary => "context.parts.summary",
        Part::Messages => "context.parts.messages",
    }
}

fn ratio_of(usage: &ContextUsage) -> Option<f64> {
    usage
        .window_tokens
        .filter(|w| *w > 0.)
        .map(|w| (usage.used_tokens / w).min(1.))
}

/// The meter: the ring as a popover's trigger, the details inside.
pub(super) fn meter(chat: WeakEntity<ChatScreen>, usage: Option<ContextUsage>, window: &mut Window) -> AnyElement {
    let p = theme::palette(window);
    let ratio = usage.as_ref().and_then(ratio_of);
    let label = match (&usage, ratio) {
        (Some(_), Some(r)) => t!("context.used", percent = format::percent(r)).into_owned(),
        (Some(u), None) => t!("context.tokensOnly", tokens = format::compact(u.used_tokens)).into_owned(),
        _ => t!("context.title").into_owned(),
    };
    let tone = if ratio.is_some_and(|r| r >= ALERT) {
        p.warning
    } else {
        p.text_muted
    };
    let trigger = Button::mark(
        "context-meter",
        crate::ui::ring::ring(ratio.unwrap_or(0.) as f32, 18., 2.5, tone, p.border_strong),
        format!("{} · {label}", t!("context.title")),
    )
    .round();
    gpui_kit::component::popover::Popover::new("context-popover")
        .anchor(Anchor::BottomRight)
        .offset(px(6.))
        .appearance(false)
        .trigger(trigger)
        .content(move |_, window, cx| {
            let popover = cx.entity();
            details(chat.clone(), usage.clone(), popover, window)
        })
        .into_any_element()
}

fn details(
    chat: WeakEntity<ChatScreen>,
    usage: Option<ContextUsage>,
    popover: Entity<gpui_kit::component::popover::PopoverState>,
    window: &mut Window,
) -> AnyElement {
    let p = theme::palette(window);
    let panel = crate::ui::layout::panel("context-details", p)
        .w(px(320.))
        .flex()
        .flex_col();
    let Some(usage) = usage else {
        return panel
            .child(
                div()
                    .p(px(space::X4))
                    .text_color(p.text_muted)
                    .child(t!("context.reading").into_owned()),
            )
            .into_any_element();
    };
    let ratio = ratio_of(&usage);
    let total = usage.window_tokens.unwrap_or(usage.used_tokens).max(1.);
    let parts: Vec<_> = usage.parts.iter().filter(|x| x.tokens > 0.).collect();
    let free = usage.window_tokens.map(|w| (w - usage.used_tokens).max(0.));
    let dot = |c: Rgba| div().flex_none().size(px(8.)).rounded_full().bg(c);
    let line = |mark: Div, name: String, tokens: f64| {
        div()
            .flex()
            .items_center()
            .gap(px(space::X2_5))
            .text_sm()
            .child(mark)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(p.text_secondary)
                    .child(name),
            )
            .child(div().child(format::compact(tokens)))
    };
    let (compact, fresh) = (chat.clone(), chat);
    let (close_a, close_b) = (popover.clone(), popover);
    panel
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X3))
                .p(px(space::X3))
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .gap(px(space::X3))
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(t!("context.title").into_owned()),
                        )
                        .when_some(ratio, |d, r| {
                            d.child(
                                div()
                                    .text_sm()
                                    .text_color(if r >= ALERT { p.warning } else { p.text_muted })
                                    .child(t!("context.used", percent = format::percent(r)).into_owned()),
                            )
                        }),
                )
                // One whole split into its parts, the free room as the track.
                .child(
                    div()
                        .flex()
                        .gap(px(2.))
                        .h(px(6.))
                        .rounded_full()
                        .overflow_hidden()
                        .bg(p.bg_control)
                        .children(parts.iter().map(|x| {
                            div()
                                .h_full()
                                .min_w(px(4.))
                                .w(relative((x.tokens / total) as f32))
                                .rounded_full()
                                .bg(color_of(x.id, p))
                        })),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(match usage.window_tokens {
                            Some(w) => t!(
                                "context.ofWindow",
                                used = format::compact(usage.used_tokens),
                                window = format::compact(w)
                            )
                            .into_owned(),
                            None => t!("context.windowUnknown", used = format::compact(usage.used_tokens)).into_owned(),
                        }),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(space::X1_5))
                        .children(
                            parts
                                .iter()
                                .map(|x| line(dot(color_of(x.id, p)), t!(key_of(x.id)).into_owned(), x.tokens)),
                        )
                        .when_some(free, |d, f| {
                            d.child(line(dot(p.bg_control), t!("context.free").into_owned(), f))
                        }),
                )
                .when_some(usage.last_input_tokens, |d, n| {
                    d.child(
                        div()
                            .text_sm()
                            .text_color(p.text_secondary)
                            .child(t!("context.lastRead", tokens = format::compact(n)).into_owned()),
                    )
                })
                .child(div().text_sm().text_color(p.text_muted).child(format!(
                    "{} {}",
                    t!(
                        "context.autoCompact",
                        after = usage.compact_after,
                        now = usage.messages_since_summary
                    ),
                    t!("context.estimate")
                ))),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .pt(px(space::X1))
                .border_t_1()
                .border_color(p.border)
                .child(
                    crate::ui::nav::NavRow::new("context-compact", t!("context.compactNow").into_owned())
                        .icon(IconName::Minimize2)
                        .on_click(move |_, window, cx| {
                            close_a.update(cx, |s, cx| s.dismiss(window, cx));
                            let _ = compact.update(cx, |this, cx| this.compact(cx));
                        }),
                )
                .child(
                    crate::ui::nav::NavRow::new("context-new", t!("context.newChat").into_owned())
                        .icon(IconName::SquarePen)
                        .on_click(move |_, window, cx| {
                            close_b.update(cx, |s, cx| s.dismiss(window, cx));
                            let _ = fresh.update(cx, |this, cx| {
                                let project_id = this
                                    .store
                                    .read(cx)
                                    .chat(&this.chat_id)
                                    .and_then(|c| c.project_id.clone());
                                cx.emit(ChatEvent::Navigate(crate::route::Route::Home { project_id }))
                            });
                        }),
                ),
        )
        .into_any_element()
}
