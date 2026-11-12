// Build with AI (apps/web/src/features/builder.tsx): a fresh conversation with the Builder, Zorel's own agent, on the
// best model at hand (Claude Code's Sonnet, else a Codex model, else any subscription, else any). Each visit starts
// one; it then lives as a chat in Builder mode (screens/chat.rs). No model anywhere, or the engine failing, says so
// with a way out.
// ponytail: "Build it myself" (the manual form) and the setup panel's powers come with the agent page.
use gpui_kit::{prelude::FluentBuilder, *};
use rust_i18n::t;
use serde_json::json;

use crate::{
    net::types::{Chat, ModelInfo},
    runtime,
    screens::chat::{ChatEvent, ChatScreen},
    state::store::Store,
    theme,
    ui::{
        button::{Button, Size, Variant},
        face::AgentFace,
        space,
    },
};

/// The model the Builder starts on: Claude Code's Sonnet when it's there, else a Codex model, else the first
/// subscription model ready, else any ready one.
pub fn builder_model(models: &[ModelInfo]) -> Option<String> {
    let ready: Vec<&ModelInfo> = models.iter().filter(|m| m.available && !m.id.ends_with('…')).collect();
    for preferred in ["claude-cli/sonnet", "codex-cli/"] {
        let hit = ready.iter().find(|m| {
            if preferred.ends_with('/') {
                m.id.starts_with(preferred)
            } else {
                m.id == preferred
            }
        });
        if let Some(m) = hit {
            return Some(m.id.clone());
        }
    }
    ready
        .iter()
        .find(|m| matches!(m.kind, crate::net::types::ModelInfoKind::Subscription))
        .or(ready.first())
        .map(|m| m.id.clone())
}

enum State {
    Starting,
    NoModel,
    Failed,
    Ready(Entity<ChatScreen>),
}

pub struct Builder {
    store: Entity<Store>,
    project_id: Option<String>,
    state: State,
}

impl EventEmitter<ChatEvent> for Builder {}

impl Builder {
    pub fn new(store: Entity<Store>, project_id: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            store,
            project_id,
            state: State::Starting,
        };
        this.start(window, cx);
        this
    }

    fn start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.state = State::Starting;
        let store = self.store.read(cx);
        let Some(model) = builder_model(&store.models) else {
            self.state = State::NoModel;
            return;
        };
        let http = store.http.clone();
        let body = json!({ "projectId": self.project_id, "model": model });
        cx.spawn_in(window, async move |this, cx| {
            let made = runtime::spawn(async move { http.post::<_, Chat>("/api/agents/builder", &body).await }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.state = match made {
                    Ok(Ok(chat)) => {
                        this.store.update(cx, |s, cx| s.reload_chats(cx));
                        let store = this.store.clone();
                        let screen = cx.new(|cx| ChatScreen::new(chat.id, store, window, cx).builder());
                        // What the chat asks for (open a made agent's chat, go somewhere) goes up.
                        cx.subscribe(&screen, |_, _, event: &ChatEvent, cx| match event {
                            ChatEvent::Navigate(r) => cx.emit(ChatEvent::Navigate(r.clone())),
                            ChatEvent::ChatWith(id) => cx.emit(ChatEvent::ChatWith(id.clone())),
                        })
                        .detach();
                        State::Ready(screen)
                    }
                    _ => State::Failed,
                };
                cx.notify();
            });
        })
        .detach();
    }
}

impl Render for Builder {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Builder {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let (title, hint) = match &self.state {
            State::Ready(screen) => return div().size_full().child(screen.clone()).into_any_element(),
            State::Starting => return div().size_full().into_any_element(),
            State::NoModel => ("builder.noModelTitle", "builder.noModel"),
            State::Failed => ("builder.failedTitle", "builder.failed"),
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(space::X2))
            .child(AgentFace::new("builder-offline", 0).size(40.))
            .child(div().font_weight(FontWeight::SEMIBOLD).child(t!(title).into_owned()))
            .child(
                div()
                    .max_w(px(380.))
                    .text_center()
                    .text_color(p.text_muted)
                    .child(t!(hint).into_owned()),
            )
            .when(matches!(self.state, State::Failed), |c| {
                c.child(
                    div().pt(px(space::X2)).child(
                        Button::new("builder-retry", t!("common.retry").into_owned())
                            .variant(Variant::Secondary)
                            .size(Size::Sm)
                            .on_click(cx.listener(|this, _, window, cx| this.start(window, cx))),
                    ),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::builder_model;
    use crate::net::types::ModelInfo;

    fn model(id: &str, available: bool, kind: &str) -> ModelInfo {
        serde_json::from_value(serde_json::json!({
            "id": id, "provider": id.split('/').next().unwrap_or(""), "kind": kind, "available": available,
            "hint": "", "name": null, "note": null
        }))
        .expect("a model")
    }

    #[test]
    fn the_builder_prefers_sonnet_then_codex_then_any_subscription() {
        let models = [
            model("codex-cli/default", true, "subscription"),
            model("claude-cli/sonnet", true, "subscription"),
        ];
        assert_eq!(builder_model(&models).as_deref(), Some("claude-cli/sonnet"));
        let models = [
            model("openai/gpt-x", true, "api"),
            model("codex-cli/default", true, "subscription"),
        ];
        assert_eq!(builder_model(&models).as_deref(), Some("codex-cli/default"));
        assert_eq!(
            builder_model(&[model("claude-cli/sonnet", false, "subscription")]),
            None
        );
    }
}
