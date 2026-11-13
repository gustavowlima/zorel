// "Your browser" (the side panel's own browser, as Zeron does it): the system's web view (WKWebView on macOS, WebView2
// on Windows, through wry) laid as a child of the window over a box GPUI keeps for it, for previewing the project's
// servers and any page. GPUI draws the chrome: back, forward, reload, the address (Enter goes; a bare host gets a
// scheme), and "Pick an element", which lets you click something on the page and sends what it is to the message box.
// The page is a native view above GPUI's drawing, so it hides whenever its box isn't on screen (another tab, the panel
// closed, a drawer or dialog over the chat). The agents' browser is another tab (screens/browser.rs): agents never
// see this one. Linux would need GTK for wry: there the tab opens pages in the system browser.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::input::{Input, InputEvent, InputState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    theme::{self, tokens},
    ui::{
        button::{Button, Size, Variant},
        icon::{self, icon},
        space,
    },
};

pub type OnPick = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;

/// What's typed in the address bar, as a URL: a scheme kept, `localhost`/an IP/a port served over http, anything else
/// with a dot over https, and words searched.
pub fn url_of(typed: &str) -> String {
    let t = typed.trim();
    if t.contains("://") || t.starts_with("about:") {
        return t.to_string();
    }
    let host = t.split(['/', '?', '#']).next().unwrap_or(t);
    let local = host.starts_with("localhost")
        || host.starts_with("127.")
        || host.starts_with("0.0.0.0")
        || host.starts_with('[')
        || host
            .split(':')
            .next()
            .is_some_and(|h| h.parse::<std::net::Ipv4Addr>().is_ok());
    if local {
        return format!("http://{t}");
    }
    if host.contains('.') && !t.contains(' ') {
        return format!("https://{t}");
    }
    let q: String = t
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    format!("https://duckduckgo.com/?q={q}")
}

/// The script "Pick an element" runs: outline what the pointer is over, and on a click post what it is (its tag, a
/// CSS path, its text, the page) and stop. Esc cancels.
const PICK_SCRIPT: &str = r#"(() => {
  if (window.__zorelPick) return; window.__zorelPick = true;
  const box = document.createElement('div');
  Object.assign(box.style, {position:'fixed', pointerEvents:'none', zIndex:2147483647, border:'2px solid #3b82f6', background:'rgba(59,130,246,.12)', borderRadius:'4px'});
  document.body.appendChild(box);
  const path = (el) => { const parts = []; while (el && el.nodeType === 1 && parts.length < 6) { let s = el.tagName.toLowerCase(); if (el.id) { s += '#' + el.id; parts.unshift(s); break; } const c = [...el.classList].slice(0,2).join('.'); if (c) s += '.' + c; parts.unshift(s); el = el.parentElement; } return parts.join(' > '); };
  const move = (e) => { const r = e.target.getBoundingClientRect(); Object.assign(box.style, {left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px'}); };
  const done = () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); box.remove(); window.__zorelPick = false; };
  const click = (e) => { e.preventDefault(); e.stopPropagation(); const el = e.target; window.ipc.postMessage(JSON.stringify({tag: el.tagName.toLowerCase(), path: path(el), text: (el.innerText || el.value || '').trim().slice(0, 400), html: el.outerHTML.slice(0, 600), page: location.href})); done(); };
  const key = (e) => { if (e.key === 'Escape') done(); };
  document.addEventListener('mousemove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
})();"#;

/// What the page tells the chrome.
enum Note {
    Loaded(String),
    Title(String),
    Picked(String),
}

pub struct LocalBrowser {
    address: Entity<InputState>,
    title: String,
    url: String,
    on_pick: OnPick,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    page: Option<wry::WebView>,
    /// The box the page sits in, as last painted (logical px).
    bounds: Rc<std::cell::Cell<Option<Bounds<Pixels>>>>,
    /// Something covers its box (a drawer, a dialog): the page stays hidden while it does.
    pub covered: bool,
    notes: tokio::sync::mpsc::UnboundedSender<Note>,
    _reader: Task<()>,
    _sub: Subscription,
}

impl LocalBrowser {
    pub fn new(on_pick: OnPick, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let address = cx.new(|cx| InputState::new(window, cx).placeholder(t!("browser.addressHint").into_owned()));
        let sub = cx.subscribe_in(&address, window, |this, input, e: &InputEvent, _, cx| {
            if let InputEvent::PressEnter { .. } = e {
                let typed = input.read(cx).value().to_string();
                if !typed.trim().is_empty() {
                    this.go(&url_of(&typed), cx);
                }
            }
        });
        let (notes, mut rx) = tokio::sync::mpsc::unbounded_channel::<Note>();
        let reader = cx.spawn_in(window, async move |this, cx| {
            while let Some(note) = rx.recv().await {
                let Ok(()) = this.update_in(cx, |this, window, cx| {
                    match note {
                        Note::Loaded(url) => {
                            this.url = url.clone();
                            if !this.address.read(cx).focus_handle(cx).is_focused(window) {
                                this.address.update(cx, |a, cx| a.set_value(url, window, cx));
                            }
                        }
                        Note::Title(title) => this.title = title,
                        Note::Picked(json) => {
                            let text = picked_text(&json);
                            (this.on_pick)(text, window, cx);
                        }
                    }
                    cx.notify();
                }) else {
                    break;
                };
            }
        });
        Self {
            address,
            title: String::new(),
            url: String::new(),
            on_pick,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            page: None,
            bounds: Rc::default(),
            covered: false,
            notes,
            _reader: reader,
            _sub: sub,
        }
    }

    /// Opens a page (a server from the Terminal, the address bar).
    pub fn go(&mut self, url: &str, cx: &mut Context<Self>) {
        self.url = url.to_string();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(page) = &self.page {
            let _ = page.load_url(url);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        cx.open_url(url);
        cx.notify();
    }

    /// Hides the native page (its box isn't on screen: another tab, the panel closed, something over the chat).
    pub fn hide(&self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(page) = &self.page {
            let _ = page.set_visible(false);
        }
    }

    fn run(&self, script: &str) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(page) = &self.page {
            let _ = page.evaluate_script(script);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = script;
    }

    /// The page, made on first show as a child of the window.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn ensure_page(&mut self, window: &Window) {
        if self.page.is_some() {
            return;
        }
        let (loads, titles, picks) = (self.notes.clone(), self.notes.clone(), self.notes.clone());
        let start = if self.url.is_empty() {
            "about:blank".to_string()
        } else {
            self.url.clone()
        };
        let built = wry::WebViewBuilder::new()
            .with_url(start)
            .with_visible(false)
            .with_focused(false)
            // Never a scheme that leaves the page (javascript:, file: from the web, app links).
            .with_navigation_handler(|url| {
                url.starts_with("http://") || url.starts_with("https://") || url.starts_with("about:")
            })
            .with_on_page_load_handler(move |event, url| {
                if matches!(event, wry::PageLoadEvent::Finished) {
                    let _ = loads.send(Note::Loaded(url));
                }
            })
            .with_document_title_changed_handler(move |title| {
                let _ = titles.send(Note::Title(title));
            })
            .with_ipc_handler(move |req| {
                let _ = picks.send(Note::Picked(req.body().clone()));
            })
            .build_as_child(window);
        match built {
            Ok(page) => self.page = Some(page),
            Err(e) => eprintln!("webview: {e}"),
        }
    }
}

/// A picked element, as a paragraph for the message box.
fn picked_text(json: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    let get = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    let mut out = format!("On {}, the `{}` element at `{}`", get("page"), get("tag"), get("path"));
    let text = get("text");
    if !text.is_empty() {
        out.push_str(&format!(" (“{}”)", text.lines().next().unwrap_or_default()));
    }
    out.push_str(&format!(":\n```html\n{}\n```", get("html")));
    out
}

impl Render for LocalBrowser {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.ensure_page(window);
        let script = |js: &'static str| {
            cx.listener(move |this: &mut LocalBrowser, _, _, cx| {
                this.run(js);
                cx.notify();
            })
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
            .child(
                Button::icon_only("web-back", IconName::ArrowLeft, t!("browser.back").into_owned())
                    .size(Size::Xs)
                    .on_click(script("history.back()")),
            )
            .child(
                Button::icon_only("web-forward", IconName::ArrowRight, t!("browser.forward").into_owned())
                    .size(Size::Xs)
                    .on_click(script("history.forward()")),
            )
            .child(
                Button::icon_only("web-reload", IconName::RefreshCw, t!("browser.reload").into_owned())
                    .size(Size::Xs)
                    .on_click(script("location.reload()")),
            )
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
                Button::new("web-go", t!("browser.go").into_owned())
                    .variant(Variant::Ghost)
                    .size(Size::Sm)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let typed = address.read(cx).value().to_string();
                        if !typed.trim().is_empty() {
                            this.go(&url_of(&typed), cx);
                        }
                    })),
            )
            .child(
                Button::icon_only("web-pick", IconName::MousePointerClick, t!("browser.pick").into_owned())
                    .size(Size::Xs)
                    .on_click(script(PICK_SCRIPT)),
            );
        let bounds = self.bounds.clone();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let page_ref = self.page.as_ref().map(|_| cx.entity().downgrade());
        let body: AnyElement = if cfg!(any(target_os = "macos", target_os = "windows")) {
            // The box the native page covers: placed and shown each frame it's painted.
            canvas(
                move |b, _, _| {
                    bounds.set(Some(b));
                    b
                },
                move |_, b, _, cx| {
                    #[cfg(any(target_os = "macos", target_os = "windows"))]
                    if let Some(entity) = page_ref.as_ref().and_then(|e| e.upgrade()) {
                        let me = entity.read(cx);
                        if let Some(page) = &me.page {
                            if me.covered {
                                let _ = page.set_visible(false);
                                return;
                            }
                            let rect = wry::Rect {
                                position: wry::dpi::LogicalPosition::new(
                                    f32::from(b.origin.x) as f64,
                                    f32::from(b.origin.y) as f64,
                                )
                                .into(),
                                size: wry::dpi::LogicalSize::new(
                                    f32::from(b.size.width) as f64,
                                    f32::from(b.size.height) as f64,
                                )
                                .into(),
                            };
                            let _ = page.set_bounds(rect);
                            let _ = page.set_visible(true);
                        }
                    }
                    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                    let _ = (b, cx);
                },
            )
            .size_full()
            .into_any_element()
        } else {
            // No native web view here: pages open in the system browser.
            let url = self.url.clone();
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
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("browser.systemHint").into_owned()),
                )
                .when(!url.is_empty(), |d| {
                    d.child(
                        Button::new("web-open-system", t!("browser.openSystem").into_owned())
                            .variant(Variant::Secondary)
                            .size(Size::Sm)
                            .on_click(move |_, _, cx| cx.open_url(&url)),
                    )
                })
                .into_any_element()
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(toolbar)
            .when(!self.title.is_empty(), |d| {
                d.child(
                    div()
                        .flex_none()
                        .px(px(space::X3))
                        .py(px(space::X1))
                        .text_xs()
                        .text_color(p.text_muted)
                        .truncate()
                        .child(self.title.clone()),
                )
            })
            .child(div().flex_1().min_h_0().bg(p.bg_code).child(body))
    }
}

#[cfg(test)]
mod tests {
    use super::url_of;

    #[test]
    fn what_is_typed_becomes_a_url() {
        assert_eq!(url_of("localhost:5173"), "http://localhost:5173");
        assert_eq!(url_of("127.0.0.1:3000/x"), "http://127.0.0.1:3000/x");
        assert_eq!(url_of("zorel.dev"), "https://zorel.dev");
        assert_eq!(url_of("https://a.b/c"), "https://a.b/c");
        assert!(url_of("rust gpui").starts_with("https://duckduckgo.com/?q=rust+gpui"));
    }
}
