// A dialog's sheet (apps/web/src/ui/dialog.tsx): the sheet radius, a strong border, the canvas, 24px padding and 16px
// between its parts; the title at 17/24 semibold, an optional muted description, the body, and the actions on the
// right. The kit's dialog host keeps the behaviour (the overlay, focus, Escape, its entrance); only the look is ours.
use gpui_kit::{component::dialog::Dialog, prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::space,
};

/// The web's sizes: sm 384, lg 576, xl 672.
#[derive(Clone, Copy)]
pub enum Width {
    Sm,
    Lg,
    Xl,
}

impl Width {
    fn px(self) -> f32 {
        match self {
            Width::Sm => 384.,
            Width::Lg => 576.,
            Width::Xl => 672.,
        }
    }
}

pub struct Sheet {
    pub title: String,
    pub description: Option<String>,
    pub body: Option<AnyElement>,
    pub actions: Vec<AnyElement>,
}

/// Dresses the kit's dialog as Zorel's sheet.
pub fn sheet(dialog: Dialog, window: &Window, width: Width, sheet: Sheet) -> Dialog {
    let p = theme::palette(window);
    dialog
        .close_button(false)
        .w(px(width.px()))
        .rounded(px(tokens::RADIUS_SHEET))
        .border_color(p.border_strong)
        .bg(p.bg_canvas)
        .p(px(space::X6))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X4))
                .text_color(p.text)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(space::X1))
                        .child(
                            div()
                                .text_size(px(17.))
                                .line_height(px(24.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(sheet.title),
                        )
                        .when_some(sheet.description, |c, d| {
                            c.child(div().text_color(p.text_muted).child(d))
                        }),
                )
                .children(sheet.body)
                .child(div().flex().justify_end().gap(px(space::X2)).children(sheet.actions)),
        )
}

/// A text field's frame (prototype `.field`): 32px, the control radius, the field wash and a strong hairline.
pub fn field(window: &Window, input: impl IntoElement) -> Div {
    let p = theme::palette(window);
    div()
        .flex()
        .items_center()
        .h(px(tokens::CONTROL_H))
        .px(px(space::X2_5))
        .rounded(px(tokens::RADIUS_CONTROL))
        .bg(p.bg_field)
        .border_1()
        .border_color(p.border_strong)
        .child(input)
}
