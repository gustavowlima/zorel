// The browser card in a reply (apps/web/src/features/browser-card.tsx): when an agent used its browser in a turn, the
// reply shows whose browser it was, its last action and the address it ended on, and, on each agent's latest such
// reply, a picture of that browser now (GET /api/browser/picture, every few seconds while it shows). Take over, the
// full-screen button and the picture open that browser in the panel, full screen, to drive it.
use std::sync::Arc;

use super::*;

const REFRESH_MS: u64 = 4000;

/// What the step did, by its tool (browser_navigate → navigate); one we don't name is "steps".
const DID: [&str; 13] = [
    "navigate", "read", "click", "type", "press", "hover", "select", "scroll", "wait", "tabs", "back", "upload",
    "dialog",
];

/// The server's name for an agent's browser profile (browser.ts profileOf).
fn owner_of(agent_id: Option<&str>) -> String {
    let id: String = agent_id
        .unwrap_or("assistant")
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(64)
        .collect();
    if id.is_empty() { "assistant".into() } else { id }
}

fn kind_of(tool: &str) -> &'static str {
    let k = tool.strip_prefix("browser_").unwrap_or(tool);
    let k = if k == "snapshot" { "read" } else { k };
    DID.iter().find(|d| **d == k).copied().unwrap_or("steps")
}

fn is_browser(s: &Step) -> bool {
    s.tool.starts_with("browser_")
}

/// The address a navigate step opened, if its arguments say it.
fn url_of(s: &Step) -> Option<String> {
    (kind_of(&s.tool) == "navigate")
        .then(|| serde_json::from_str::<serde_json::Value>(&s.args).ok())
        .flatten()
        .and_then(|a| a["url"].as_str().map(str::to_string))
        .filter(|u| !u.is_empty())
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_else(|| url.to_string())
}

impl ChatScreen {
    /// The card under a reply that used its browser (None otherwise).
    pub(super) fn browser_card(
        &mut self,
        i: usize,
        m: &Message,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let steps: Vec<&Step> = m.steps.iter().filter(|s| is_browser(s)).collect();
        let last = steps.last()?;
        let p = theme::palette(window);
        let owner = owner_of(m.agent_id.as_deref());
        // Only an agent's latest such reply shows the browser now (an older one would show today's page, not its own).
        let live = !self.log.messages[i + 1..]
            .iter()
            .any(|later| owner_of(later.agent_id.as_deref()) == owner && later.steps.iter().any(is_browser));
        if live {
            self.follow_picture(&owner, cx);
        }
        let name = self.store.read(cx).agent_name(m.agent_id.as_deref());
        let did = t!(format!("browser.card.did.{}", kind_of(&last.tool))).to_lowercase();
        let url = steps.iter().rev().find_map(|s| url_of(s));
        let picture = live.then(|| self.browser_pictures.get(&owner).cloned()).flatten();
        let (take, full, shot) = (owner.clone(), owner.clone(), owner.clone());
        Some(
            div()
                .flex()
                .flex_col()
                .rounded(px(tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .bg(p.bg_surface)
                .overflow_hidden()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X2))
                        .px(px(space::X3))
                        .py(px(space::X1_5))
                        .border_b_1()
                        .border_color(p.border)
                        .child(icon(IconName::Globe, icon::SM).text_color(p.text_muted))
                        .child(
                            div().flex_1().min_w_0().truncate().text_sm().child(
                                div()
                                    .flex()
                                    .child(
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(t!("browser.card.title", name = name).into_owned()),
                                    )
                                    .child(div().text_color(p.text_muted).child(format!(" · {did}"))),
                            ),
                        )
                        .child(
                            Button::new(
                                SharedString::from(format!("bcard-take-{}", m.id)),
                                t!("browser.card.takeOver").into_owned(),
                            )
                            .icon(IconName::MousePointerClick)
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(
                                cx.listener(move |this, _, window, cx| this.open_browser(take.clone(), window, cx)),
                            ),
                        )
                        .child(
                            Button::icon_only(
                                SharedString::from(format!("bcard-full-{}", m.id)),
                                IconName::Maximize2,
                                t!("browser.fullScreen").into_owned(),
                            )
                            .size(Size::Xs)
                            .on_click(
                                cx.listener(move |this, _, window, cx| this.open_browser(full.clone(), window, cx)),
                            ),
                        ),
                )
                .when(url.is_some() || picture.is_some(), |d| {
                    d.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X2))
                            .p(px(space::X3))
                            .when_some(url, |d, url| {
                                d.child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(space::X2))
                                        .h(px(tokens::CONTROL_H_SM))
                                        .px(px(space::X3))
                                        .rounded_full()
                                        .bg(p.bg_control)
                                        .text_sm()
                                        .text_color(p.text_muted)
                                        .child(icon(IconName::Globe, icon::XS))
                                        .child(div().truncate().child(host_of(&url))),
                                )
                            })
                            .when_some(picture, |d, image| {
                                d.child(
                                    div()
                                        .id(SharedString::from(format!("bcard-shot-{}", m.id)))
                                        .rounded(px(tokens::RADIUS_CONTROL))
                                        .border_1()
                                        .border_color(p.border)
                                        .overflow_hidden()
                                        .cursor_pointer()
                                        .child(img(image).w_full())
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            this.open_browser(shot.clone(), window, cx)
                                        })),
                                )
                            }),
                    )
                })
                .into_any_element(),
        )
    }

    /// Opens `owner`'s browser in the side panel, full screen, to drive it.
    fn open_browser(&mut self, owner: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.side.is_none() {
            self.side = Some(side::Side::default());
        }
        self.open_tab(side::Tab::Browser, cx);
        self.browser_tab(window, cx);
        if let Some(b) = &self.browser {
            b.update(cx, |b, cx| b.focus_owner(owner, true, cx));
        }
    }

    /// Keeps `owner`'s picture fresh while a live card shows it: one loop per owner, ending once no card asks for it.
    fn follow_picture(&mut self, owner: &str, cx: &mut Context<Self>) {
        self.browser_shown.insert(owner.to_string());
        if self.browser_polls.contains_key(owner) {
            return;
        }
        let (http, owner_id) = (self.store.read(cx).http.clone(), owner.to_string());
        let path = format!(
            "/api/browser/picture?chat={}&owner={}",
            crate::net::http::uri_encode(&self.chat_id),
            crate::net::http::uri_encode(owner)
        );
        let task = cx.spawn(async move |this, cx| {
            loop {
                let http = http.clone();
                let path = path.clone();
                let got = runtime::spawn(async move { http.bytes(&path).await }).await;
                let keep = this.update(cx, |this, cx| {
                    if let Ok(Ok(bytes)) = got {
                        this.browser_pictures
                            .insert(owner_id.clone(), Arc::new(Image::from_bytes(ImageFormat::Jpeg, bytes)));
                        cx.notify();
                    }
                    // Asked for again since the last round (each render re-asks while the card shows).
                    let asked = this.browser_shown.remove(&owner_id);
                    if !asked {
                        this.browser_polls.remove(&owner_id);
                    }
                    asked
                });
                if !matches!(keep, Ok(true)) {
                    break;
                }
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(REFRESH_MS))
                    .await;
            }
        });
        self.browser_polls.insert(owner.to_string(), task);
    }
}

#[cfg(test)]
mod tests {
    use super::{host_of, kind_of, owner_of};

    #[test]
    fn owners_kinds_and_hosts_read_as_the_server_names_them() {
        assert_eq!(owner_of(Some("Agent_X-1")), "agentx-1");
        assert_eq!(owner_of(None), "assistant");
        assert_eq!(kind_of("browser_snapshot"), "read");
        assert_eq!(kind_of("browser_navigate"), "navigate");
        assert_eq!(kind_of("browser_whatever"), "steps");
        assert_eq!(host_of("https://www.example.com/a"), "example.com");
    }
}
