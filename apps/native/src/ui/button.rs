// Zorel's button (apps/web/src/ui/button.tsx) on gpui-base's unstyled Button, which owns the behaviour: pointer,
// Enter/Space activation, focus, disabled, accessibility role. Variants: Primary (the solid accent, the one main
// action), Secondary (a control wash, the default), Ghost (quiet: text only until hovered), Destructive.
use gpui_kit::{base::Button as BaseButton, prelude::FluentBuilder, *};

use crate::theme::{self, tokens};

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Variant {
    Primary,
    #[default]
    Secondary,
    Ghost,
    Destructive,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Size {
    Sm,
    #[default]
    Md,
}

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: SharedString,
    variant: Variant,
    size: Size,
    disabled: bool,
    on_click: Option<OnClick>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            variant: Variant::default(),
            size: Size::default(),
            disabled: false,
            on_click: None,
        }
    }

    pub fn variant(mut self, variant: Variant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: Size) -> Self {
        self.size = size;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for Button {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        // (background, text, hovered background, hovered text) per variant.
        let (bg, fg, hover_bg, hover_fg) = match self.variant {
            Variant::Primary => (p.accent, p.on_accent, p.accent_hover, p.on_accent),
            Variant::Secondary => (p.bg_control, p.text, p.bg_control_hover, p.text),
            Variant::Ghost => (Rgba { a: 0., ..p.bg_control }, p.text_muted, p.bg_control_hover, p.text),
            Variant::Destructive => (p.danger_soft, p.danger, p.danger, p.on_accent),
        };
        let (height, pad, radius) = match self.size {
            Size::Sm => (tokens::CONTROL_H_SM, 10., tokens::RADIUS_CONTROL_SM),
            Size::Md => (tokens::CONTROL_H, 12., tokens::RADIUS_CONTROL),
        };
        BaseButton::new(self.id)
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .h(px(height))
            .px(px(pad))
            .rounded(px(radius))
            .bg(bg)
            .text_color(fg)
            .font_weight(FontWeight::MEDIUM)
            .when(!self.disabled, |b| {
                b.hover(move |s| s.bg(hover_bg).text_color(hover_fg))
            })
            .when(self.disabled, |b| b.opacity(0.5))
            .when_some(self.on_click, |b, handler| b.on_click(handler))
            .child(self.label)
    }
}
