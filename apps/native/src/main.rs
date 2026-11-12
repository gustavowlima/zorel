// Zorel's native desktop client (spec 019): a GPUI window on gpui-base. The engine stays the Bun server.
use gpui_kit::*;

use zorel_native::theme;

struct App;

impl Render for App {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(theme::tokens::DARK.bg_canvas)
            .text_color(theme::tokens::DARK.text)
            .child("Zorel")
    }
}

fn main() {
    gpui_kit::application().run(|cx| {
        gpui_kit::init(cx);
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| cx.new(|_| App)).expect("open the window");
    });
}
