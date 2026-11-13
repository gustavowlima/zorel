// The chat's browser (apps/web/src/features/browser.tsx › BrowserPanel): a real browser on the engine (Playwright),
// seen here as the active tab's frames (JPEG) and driven from here. With several browsers in the chat (one per agent,
// and yours) they first show as cards with a picture each (every 4 s); opening one shows it live with its own tabs.
// The toolbar: back, forward, reload, the address (Enter goes). The page takes clicks, the wheel, keys and pastes
// (as Playwright names them); doing so takes the browser from the agents, and "Hand back" returns it. Under it: who
// holds it, what an agent is doing now (for 3 s after its last action), a password being typed (the page hides).
use std::{collections::HashMap, rc::Rc, sync::Arc};

use base64::Engine as _;
use gpui_kit::{
    assets::IconName,
    component::input::{Input, InputEvent, InputState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::{
    i18n::tn,
    net::{
        browser::{self, Down},
        http::Http,
    },
    state::store::Store,
    theme::{self, tokens},
    ui::{
        button::{Button, Size, Variant},
        icon::{self, icon},
        space,
    },
};

const YOU: &str = "you";
const IDLE_MS: u64 = 3000;
const PREVIEW_MS: u64 = 4000;

fn is_yours(owner: &str) -> bool {
    owner == YOU || owner.starts_with("you--")
}

fn agent_of(owner: &str) -> &str {
    owner.split("--").next().unwrap_or(owner)
}

#[derive(Clone, Debug, PartialEq)]
struct Tab {
    id: String,
    title: String,
    url: String,
    active: bool,
    owner: String,
}

/// The i18n key for what an agent's browser tool is doing.
fn doing_key(tool: &str) -> &'static str {
    match tool {
        "browser_navigate" => "browser.doing.navigate",
        "browser_snapshot" => "browser.doing.read",
        "browser_click" => "browser.doing.click",
        "browser_type" => "browser.doing.type",
        "browser_press" => "browser.doing.press",
        "browser_hover" => "browser.doing.hover",
        "browser_select" => "browser.doing.select",
        "browser_scroll" => "browser.doing.scroll",
        "browser_wait" => "browser.doing.wait",
        "browser_tabs" => "browser.doing.tabs",
        "browser_back" => "browser.doing.back",
        "browser_upload" => "browser.doing.upload",
        "browser_dialog" => "browser.doing.dialog",
        _ => "browser.doing.steps",
    }
}

/// A key as Playwright names it ("Control+A", "Enter"); printable text without modifiers goes as text.
pub fn key_frame(k: &Keystroke) -> Option<Value> {
    let m = &k.modifiers;
    if let Some(text) = k.key_char.as_ref().filter(|_| !m.control && !m.platform && !m.alt) {
        return Some(json!({ "t": "text", "text": text }));
    }
    let name = match k.key.as_str() {
        "enter" => "Enter".to_string(),
        "backspace" => "Backspace".into(),
        "tab" => "Tab".into(),
        "escape" => "Escape".into(),
        "up" => "ArrowUp".into(),
        "down" => "ArrowDown".into(),
        "left" => "ArrowLeft".into(),
        "right" => "ArrowRight".into(),
        "home" => "Home".into(),
        "end" => "End".into(),
        "pageup" => "PageUp".into(),
        "pagedown" => "PageDown".into(),
        "delete" => "Delete".into(),
        "space" => "Space".into(),
        k if k.chars().count() == 1 => k.to_uppercase(),
        k if k.starts_with('f') && k[1..].parse::<u8>().is_ok() => k.to_uppercase(),
        _ => return None,
    };
    let mods: Vec<&str> = [
        (m.control, "Control"),
        (m.alt, "Alt"),
        (m.platform, "Meta"),
        (m.shift && name.chars().count() > 1, "Shift"),
    ]
    .into_iter()
    .filter_map(|(on, n)| on.then_some(n))
    .collect();
    let key = mods
        .into_iter()
        .chain(std::iter::once(name.as_str()))
        .collect::<Vec<_>>()
        .join("+");
    (key.len() <= 40).then(|| json!({ "t": "key", "key": key }))
}

pub struct Browser {
    store: Entity<Store>,
    up: mpsc::UnboundedSender<Value>,
    tabs: Vec<Tab>,
    held: bool,
    yours: bool,
    masked: bool,
    may_control: bool,
    frame: Option<Arc<Image>>,
    previews: HashMap<String, Arc<Image>>,
    /// The agent at work now (agent id, tool, target), until a while after its last action.
    act: Option<(Option<String>, String, Option<String>)>,
    error: Option<String>,
    cards: bool,
    address: Entity<InputState>,
    /// The active tab's address for the bar, once the window can set it.
    follow: Option<String>,
    /// Where the page was last painted (for clicks and the wheel).
    page: Rc<std::cell::Cell<Bounds<Pixels>>>,
    focus: FocusHandle,
    _reader: Task<()>,
    _previews: Task<()>,
    _subscription: Subscription,
}

impl Browser {
    pub fn new(http: Http, store: Entity<Store>, chat: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (up, mut down) = browser::connect(http, chat);
        let reader = cx.spawn(async move |this, cx| {
            while let Some(event) = down.recv().await {
                if this.update(cx, |this, cx| this.take(event, cx)).is_err() {
                    break;
                }
            }
        });
        // The cards' pictures, every few seconds while they show.
        let previews = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(PREVIEW_MS))
                    .await;
                let Ok(()) = this.update(cx, |this, _| {
                    if this.showing_cards() {
                        this.send(json!({ "t": "previews" }));
                    }
                }) else {
                    break;
                };
            }
        });
        let address = cx.new(|cx| InputState::new(window, cx).placeholder(t!("browser.addressHint").into_owned()));
        let sub = cx.subscribe_in(&address, window, |this, input, e: &InputEvent, _, cx| {
            if let InputEvent::PressEnter { .. } = e {
                let url = input.read(cx).value().trim().to_string();
                if !url.is_empty() {
                    this.send(json!({ "t": "nav", "url": url }));
                }
            }
        });
        Self {
            store,
            up,
            tabs: Vec::new(),
            held: false,
            yours: true,
            masked: false,
            may_control: true,
            frame: None,
            previews: HashMap::new(),
            act: None,
            error: None,
            cards: true,
            address,
            follow: None,
            page: Rc::default(),
            focus: cx.focus_handle(),
            _reader: reader,
            _previews: previews,
            _subscription: sub,
        }
    }

    fn send(&mut self, frame: Value) {
        self.error = None;
        let watch_only = !self.may_control && !matches!(frame["t"].as_str(), Some("view" | "previews"));
        if !watch_only {
            let _ = self.up.send(frame);
        }
    }

    /// Opens a page in a new tab (a server from the Terminal), without taking the browser from the agents.
    pub fn open_url(&mut self, url: String) {
        self.send(json!({ "t": "open", "url": url }));
        self.cards = false;
    }

    pub fn new_tab(&mut self) {
        let owner = self.shown_owner();
        self.send(if is_yours(&owner) {
            json!({ "t": "newtab" })
        } else {
            json!({ "t": "newtab", "owner": owner })
        });
    }

    fn owners(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for t in &self.tabs {
            if !out.contains(&t.owner) {
                out.push(t.owner.clone());
            }
        }
        out
    }

    fn showing_cards(&self) -> bool {
        self.cards && self.owners().len() > 1
    }

    fn shown_owner(&self) -> String {
        self.tabs
            .iter()
            .find(|t| t.active)
            .map(|t| t.owner.clone())
            .or_else(|| self.owners().first().cloned())
            .unwrap_or_else(|| YOU.into())
    }

    fn take(&mut self, event: Down, cx: &mut Context<Self>) {
        match event {
            Down::Frame(bytes) => self.frame = Some(Arc::new(Image::from_bytes(ImageFormat::Jpeg, bytes))),
            Down::Closed => self.error = Some(t!("browser.empty").into_owned()),
            Down::Message(m) => match m["t"].as_str() {
                Some("state") => {
                    self.tabs = m["tabs"]
                        .as_array()
                        .map(|tabs| {
                            tabs.iter()
                                .map(|t| Tab {
                                    id: t["id"].as_str().unwrap_or_default().into(),
                                    title: t["title"].as_str().unwrap_or_default().into(),
                                    url: t["url"].as_str().unwrap_or_default().into(),
                                    active: t["active"].as_bool().unwrap_or(false),
                                    owner: t["owner"].as_str().unwrap_or(YOU).into(),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    self.held = m["userControl"].as_bool().unwrap_or(false);
                    self.yours = m["yours"].as_bool().unwrap_or(true);
                    self.masked = m["masked"].as_bool().unwrap_or(false);
                    self.may_control = m["mayControl"].as_bool().unwrap_or(true);
                    // The address follows the active tab (applied in render, unless it's being typed in).
                    let url = self
                        .tabs
                        .iter()
                        .find(|t| t.active)
                        .map(|t| t.url.clone())
                        .unwrap_or_default();
                    self.follow = Some(if url == "about:blank" { String::new() } else { url });
                }
                Some("previews") => {
                    if let Some(map) = m["previews"].as_object() {
                        for (owner, b64) in map {
                            if let Some(bytes) = b64
                                .as_str()
                                .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
                            {
                                self.previews
                                    .insert(owner.clone(), Arc::new(Image::from_bytes(ImageFormat::Jpeg, bytes)));
                            }
                        }
                    }
                }
                Some("error") => self.error = m["message"].as_str().map(str::to_string),
                Some("act") => {
                    let act = (
                        m["agentId"].as_str().map(str::to_string),
                        m["tool"].as_str().unwrap_or_default().to_string(),
                        m["target"].as_str().map(str::to_string),
                    );
                    self.act = Some(act.clone());
                    if m["done"].as_bool() == Some(true) {
                        cx.spawn(async move |this, cx| {
                            cx.background_executor()
                                .timer(std::time::Duration::from_millis(IDLE_MS))
                                .await;
                            let _ = this.update(cx, |this, cx| {
                                if this.act.as_ref() == Some(&act) {
                                    this.act = None;
                                    cx.notify();
                                }
                            });
                        })
                        .detach();
                    }
                }
                _ => {}
            },
        }
        cx.notify();
    }

    fn owner_label(&self, owner: &str, cx: &App) -> String {
        if is_yours(owner) {
            return t!("browser.yours").into_owned();
        }
        let agent = agent_of(owner);
        self.store.read(cx).agent_name((agent != "assistant").then_some(agent))
    }

    /// Opening a card shows that browser's tab without taking it from the agents.
    fn open_owner(&mut self, owner: &str) {
        let tab = {
            let mine: Vec<&Tab> = self.tabs.iter().filter(|t| t.owner == owner).collect();
            mine.iter()
                .find(|t| t.active)
                .or(mine.last())
                .map(|t| (t.id.clone(), t.active))
        };
        if let Some((id, false)) = tab {
            self.send(json!({ "t": "view", "id": id }));
        }
        self.cards = false;
    }

    fn at(&self, pos: Point<Pixels>) -> (f32, f32) {
        let b = self.page.get();
        let w = f32::from(b.size.width).max(1.);
        let h = f32::from(b.size.height).max(1.);
        (
            (f32::from(pos.x - b.origin.x) / w).clamp(0., 1.),
            (f32::from(pos.y - b.origin.y) / h).clamp(0., 1.),
        )
    }

    fn cards_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let owners = self.owners();
        let cards = owners.into_iter().map(|owner| {
            let label = self.owner_label(&owner, cx);
            let count = self.tabs.iter().filter(|t| t.owner == owner).count();
            let picture = self.previews.get(&owner).cloned();
            let open = owner.clone();
            div()
                .id(SharedString::from(format!("browser-card-{owner}")))
                .flex()
                .flex_col()
                .rounded(px(tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .overflow_hidden()
                .bg(p.bg_surface)
                .hover(|s| s.border_color(p.border_strong))
                .cursor_pointer()
                .child(div().h(px(120.)).bg(p.bg_code).when_some(picture, |d, img_| {
                    d.child(img(img_).size_full().object_fit(ObjectFit::Cover))
                }))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .px(px(space::X3))
                        .py(px(space::X2))
                        .text_sm()
                        .child(div().truncate().child(label))
                        .child(
                            div()
                                .text_xs()
                                .text_color(p.text_muted)
                                .child(tn("browser.tabCount", count as i64)),
                        ),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.open_owner(&open);
                    cx.notify();
                }))
        });
        div()
            .id("browser-cards")
            .flex()
            .flex_col()
            .gap(px(space::X3))
            .p(px(space::X4))
            .overflow_y_scroll()
            .size_full()
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("browser.cardsHint").into_owned()),
            )
            .child(div().grid().grid_cols(2).gap(px(space::X3)).children(cards))
            .into_any_element()
    }
}

impl Render for Browser {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        if let Some(url) = self.follow.take() {
            let typing = self.address.read(cx).focus_handle(cx).is_focused(window);
            if !typing && self.address.read(cx).value() != url.as_str() {
                self.address.update(cx, |a, cx| a.set_value(url, window, cx));
            }
        }
        if self.showing_cards() {
            return self.cards_view(window, cx);
        }
        let shown = self.shown_owner();
        let own: Vec<Tab> = self.tabs.iter().filter(|t| t.owner == shown).cloned().collect();
        let active = own.iter().any(|t| t.active);
        let several = self.owners().len() > 1;
        let tabs = own.iter().map(|tab| {
            let (pick, close) = (tab.id.clone(), tab.id.clone());
            let title = if tab.title.is_empty() {
                tab.url.clone()
            } else {
                tab.title.clone()
            };
            div()
                .id(SharedString::from(format!("browser-tab-{}", tab.id)))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(space::X1))
                .max_w(px(180.))
                .pl(px(space::X2_5))
                .pr(px(space::X1))
                .h(px(tokens::CONTROL_H_SM))
                .rounded(px(tokens::RADIUS_CONTROL_SM))
                .text_sm()
                .map(|d| {
                    if tab.active {
                        d.bg(p.bg_control).text_color(p.text)
                    } else {
                        d.text_color(p.text_muted)
                    }
                })
                .hover(|s| s.bg(p.bg_control))
                .child(div().flex_1().min_w_0().truncate().child(title))
                .child(
                    Button::icon_only(
                        SharedString::from(format!("browser-close-{}", tab.id)),
                        IconName::X,
                        t!("browser.closeTab").into_owned(),
                    )
                    .size(Size::Xs)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.send(json!({ "t": "close", "id": close }));
                        cx.notify();
                    })),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.send(json!({ "t": "tab", "id": pick }));
                    cx.notify();
                }))
        });
        let tab_row = div()
            .id("browser-tabs")
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X1))
            .px(px(space::X2))
            .py(px(space::X1_5))
            .overflow_x_scroll()
            .border_b_1()
            .border_color(p.border)
            .when(several, |d| {
                d.child(
                    Button::icon_only(
                        "browser-all",
                        IconName::LayoutGrid,
                        t!("browser.allBrowsers").into_owned(),
                    )
                    .size(Size::Xs)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.cards = true;
                        this.send(json!({ "t": "previews" }));
                        cx.notify();
                    })),
                )
            })
            .children(tabs)
            .child(
                Button::icon_only("browser-newtab", IconName::Plus, t!("browser.newTab").into_owned())
                    .size(Size::Xs)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.new_tab();
                        cx.notify();
                    })),
            );
        let nav = |id: &'static str, glyph: IconName, label: String, frame: &'static str| {
            Button::icon_only(id, glyph, label)
                .size(Size::Xs)
                .disabled(!active)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.send(json!({ "t": frame }));
                    cx.notify();
                }))
        };
        let address = self.address.clone();
        let toolbar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X1))
            .px(px(space::X2))
            .py(px(space::X1_5))
            .border_b_1()
            .border_color(p.border)
            .child(nav(
                "browser-back",
                IconName::ArrowLeft,
                t!("browser.back").into_owned(),
                "back",
            ))
            .child(nav(
                "browser-forward",
                IconName::ArrowRight,
                t!("browser.forward").into_owned(),
                "forward",
            ))
            .child(nav(
                "browser-reload",
                IconName::RefreshCw,
                t!("browser.reload").into_owned(),
                "reload",
            ))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .h(px(tokens::CONTROL_H_SM))
                    .px(px(space::X2_5))
                    .rounded(px(tokens::RADIUS_CONTROL_SM))
                    .bg(p.bg_field)
                    .text_sm()
                    .child(div().flex_1().child(Input::new(&self.address).appearance(false))),
            )
            .child(
                Button::new("browser-go", t!("browser.go").into_owned())
                    .variant(Variant::Ghost)
                    .size(Size::Sm)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let url = address.read(cx).value().trim().to_string();
                        if !url.is_empty() {
                            this.send(json!({ "t": "nav", "url": url }));
                        }
                        cx.notify();
                    })),
            );
        let page_bounds = self.page.clone();
        let page: AnyElement = if own.is_empty() {
            div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(space::X2))
                .size_full()
                .px(px(space::X6))
                .text_center()
                .child(icon(IconName::Globe, icon::MD).text_color(p.text_dim))
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .child(t!("browser.empty").into_owned()),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("browser.emptyHint").into_owned()),
                )
                .into_any_element()
        } else {
            let frame = self.frame.clone();
            div()
                .id("browser-page")
                .track_focus(&self.focus)
                .relative()
                .w_full()
                .map(|mut d| {
                    d.style().aspect_ratio = Some(16. / 10.);
                    d
                })
                .bg(p.bg_code)
                .cursor_pointer()
                .child(canvas(move |b, _, _| page_bounds.set(b), |_, _, _, _| {}).absolute().size_full())
                .when_some(frame, |d, f| d.child(img(f).size_full().object_fit(ObjectFit::Contain)))
                .when(self.masked, |d| {
                    d.child(
                        div()
                            .absolute()
                            .inset_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(p.overlay)
                            .text_sm()
                            .text_color(p.text)
                            .child(t!("browser.masked").into_owned()),
                    )
                })
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|this, e: &MouseDownEvent, window, cx| {
                        this.focus.focus(window, cx);
                        let (x, y) = this.at(e.position);
                        this.send(json!({ "t": "click", "x": x, "y": y, "button": "left", "clicks": if e.click_count == 2 { 2 } else { 1 } }));
                        cx.notify();
                    }),
                )
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(|this, e: &MouseDownEvent, _, cx| {
                        let (x, y) = this.at(e.position);
                        this.send(json!({ "t": "click", "x": x, "y": y, "button": "right", "clicks": 1 }));
                        cx.notify();
                    }),
                )
                .on_scroll(cx.listener(|this, e: &ScrollEvent, _, cx| {
                    let d = e.delta.pixel_delta(px(16.));
                    let (x, y) = this.at(e.position);
                    this.send(json!({ "t": "wheel", "x": x, "y": y, "dx": -f32::from(d.x), "dy": -f32::from(d.y) }));
                    cx.notify();
                }))
                .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                    let k = &e.keystroke;
                    if k.modifiers.platform && k.key == "v" {
                        if let Some(text) = cx.read_from_clipboard().and_then(|c| c.text()) {
                            this.send(json!({ "t": "text", "text": text.chars().take(10_000).collect::<String>() }));
                        }
                    } else if let Some(frame) = key_frame(k) {
                        this.send(frame);
                    } else {
                        return;
                    }
                    cx.stop_propagation();
                }))
                .into_any_element()
        };
        // Who holds it, or what an agent is doing.
        let status: Option<AnyElement> = if self.held && self.yours {
            Some(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .child(
                        div()
                            .flex_1()
                            .text_color(p.text_secondary)
                            .child(t!("browser.youHold").into_owned()),
                    )
                    .child(
                        Button::new("browser-release", t!("browser.handBack").into_owned())
                            .variant(Variant::Secondary)
                            .size(Size::Sm)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.send(json!({ "t": "release" }));
                                cx.notify();
                            })),
                    )
                    .into_any_element(),
            )
        } else if self.held {
            Some(
                div()
                    .text_color(p.text_muted)
                    .child(t!("browser.otherHolds").into_owned())
                    .into_any_element(),
            )
        } else if !self.may_control {
            Some(
                div()
                    .text_color(p.text_muted)
                    .child(t!("browser.watchOnly").into_owned())
                    .into_any_element(),
            )
        } else if let Some((agent, tool, target)) = &self.act {
            let name = self.store.read(cx).agent_name(agent.as_deref());
            let mut line = t!(doing_key(tool), name = name).into_owned();
            if let Some(target) = target {
                line.push_str(&format!(" “{target}”"));
            }
            Some(div().text_color(p.text_secondary).child(line).into_any_element())
        } else if !own.is_empty() {
            Some(
                div()
                    .text_color(p.text_muted)
                    .child(t!("browser.agentsMayUse").into_owned())
                    .into_any_element(),
            )
        } else {
            None
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(tab_row)
            .child(toolbar)
            .child(
                div()
                    .id("browser-body")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p(px(space::X2))
                    .child(page),
            )
            .when_some(status, |d, s| {
                d.child(
                    div()
                        .flex_none()
                        .px(px(space::X3))
                        .py(px(space::X2))
                        .border_t_1()
                        .border_color(p.border)
                        .text_sm()
                        .child(s),
                )
            })
            .when_some(self.error.clone(), |d, e| {
                d.child(
                    div()
                        .flex_none()
                        .px(px(space::X3))
                        .py(px(space::X1_5))
                        .text_sm()
                        .text_color(p.danger)
                        .child(e),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::key_frame;
    use gpui_kit::{Keystroke, Modifiers};

    fn k(key: &str, ch: Option<&str>, mods: Modifiers) -> Keystroke {
        Keystroke {
            key: key.into(),
            key_char: ch.map(str::to_string),
            modifiers: mods,
        }
    }

    #[test]
    fn keys_go_as_playwright_names_them() {
        assert_eq!(
            key_frame(&k("a", Some("a"), Modifiers::default())).unwrap()["text"],
            "a"
        );
        assert_eq!(
            key_frame(&k("enter", None, Modifiers::default())).unwrap()["key"],
            "Enter"
        );
        let ctrl = Modifiers {
            control: true,
            ..Default::default()
        };
        assert_eq!(key_frame(&k("a", Some("a"), ctrl)).unwrap()["key"], "Control+A");
        let shift = Modifiers {
            shift: true,
            ..Default::default()
        };
        assert_eq!(key_frame(&k("tab", None, shift)).unwrap()["key"], "Shift+Tab");
    }
}
