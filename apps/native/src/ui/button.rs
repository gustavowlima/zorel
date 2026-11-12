// Zorel's button (apps/web/src/ui/button.tsx) on gpui-base's unstyled Button, which owns the behaviour: pointer,
// Enter/Space activation, focus, disabled, accessibility role. Every button in the app is this one, so heights and
// radii come from one scale (styles.css --z-control-h*, --z-radius-control*): Xs 24, Sm 26 (radius 8), Md 32 and
// Lg 36 (radius 10). Variants: Primary (the solid accent, the one main action), Secondary (a control wash, the
// default), Ghost (quiet: muted until hovered), Destructive. An icon-only button is square; `round` makes it a
// circle (Send). It can be a popover's trigger (`Selectable`: open = the hovered wash stays).
use gpui_kit::{
    assets::IconName,
    base::Button as BaseButton,
    component::{Selectable, tooltip::Tooltip},
    prelude::FluentBuilder,
    *,
};

use crate::ui::icon::{self, icon};
use crate::ui::space;
use crate::{
    theme::{self, tokens},
    ui::motion,
};

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
    Xs,
    Sm,
    #[default]
    Md,
    Lg,
}

impl Size {
    /// (height, horizontal padding, radius, icon size).
    fn metrics(self) -> (f32, f32, f32, f32) {
        match self {
            Size::Xs => (tokens::CONTROL_H_XS, 8., tokens::RADIUS_CONTROL_SM, icon::SM),
            Size::Sm => (tokens::CONTROL_H_SM, 10., tokens::RADIUS_CONTROL_SM, icon::MD),
            Size::Md => (tokens::CONTROL_H, 12., tokens::RADIUS_CONTROL, icon::MD),
            Size::Lg => (tokens::CONTROL_H_LG, 16., tokens::RADIUS_CONTROL, icon::MD),
        }
    }
}

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: Option<SharedString>,
    icon: Option<IconName>,
    /// Any mark before the label (a provider's logo), instead of an icon.
    leading: Option<AnyElement>,
    /// What the button is called when it shows only an icon (also its tooltip).
    name: Option<SharedString>,
    tooltip: Option<SharedString>,
    variant: Variant,
    size: Size,
    round: bool,
    open: bool,
    disabled: bool,
    on_click: Option<OnClick>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self::bare(id).label(label)
    }

    /// An icon-only button, square at its height; `name` is what screen readers hear and the tooltip shows.
    pub fn icon_only(id: impl Into<ElementId>, icon: IconName, name: impl Into<SharedString>) -> Self {
        let name = name.into();
        let mut b = Self::bare(id);
        b.icon = Some(icon);
        b.tooltip = Some(name.clone());
        b.name = Some(name);
        b.variant = Variant::Ghost;
        b
    }

    fn bare(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            label: None,
            icon: None,
            leading: None,
            name: None,
            tooltip: None,
            variant: Variant::default(),
            size: Size::default(),
            round: false,
            open: false,
            disabled: false,
            on_click: None,
        }
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// A leading icon beside the label.
    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    /// Screen readers' name when it differs from the label.
    pub fn name(mut self, name: impl Into<SharedString>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn tooltip(mut self, tooltip: impl Into<SharedString>) -> Self {
        self.tooltip = Some(tooltip.into());
        self
    }

    pub fn variant(mut self, variant: Variant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: Size) -> Self {
        self.size = size;
        self
    }

    /// A circle (icon-only) or a pill.
    pub fn round(mut self) -> Self {
        self.round = true;
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

impl Selectable for Button {
    fn selected(mut self, selected: bool) -> Self {
        self.open = selected;
        self
    }

    fn is_selected(&self) -> bool {
        self.open
    }
}

impl RenderOnce for Button {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        // (background, text, hovered background, hovered text) per variant.
        let (bg, fg, hover_bg, hover_fg) = match self.variant {
            Variant::Primary => (p.accent, p.on_accent, p.accent_hover, p.on_accent),
            Variant::Secondary => (p.bg_control, p.text, p.bg_control_hover, p.text),
            Variant::Ghost => (Rgba { a: 0., ..p.bg_control }, p.text_muted, p.bg_control_hover, p.text),
            Variant::Destructive => (p.danger_soft, p.danger, p.danger, p.on_accent),
        };
        let (height, pad, radius, icon_size) = self.size.metrics();
        let icon_only = self.label.is_none();
        // Hover and press ease the colours; a press sinks the button a pixel on a spring.
        let pointer = motion::pointer(&self.id, window, cx);
        let state = *pointer.read(cx);
        let live = !self.disabled;
        let (bg_target, fg_target) = if live && (state.hovered || self.open) {
            (hover_bg, hover_fg)
        } else {
            (bg, fg)
        };
        let bg_now = motion::color(&self.id, "bg", bg_target, window, cx);
        let fg_now = motion::color(&self.id, "fg", fg_target, window, cx);
        let sink = motion::sink(&self.id, live && state.pressed, window, cx);
        let name = self.name.clone().or(self.label.clone()).unwrap_or_default();
        let button = BaseButton::new(self.id)
            .disabled(self.disabled)
            .accessibility_label(name)
            .relative()
            .top(sink)
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(space::X1_5))
            .h(px(height))
            .map(|b| if icon_only { b.w(px(height)) } else { b.px(px(pad)) })
            .rounded(px(if self.round { height / 2. } else { radius }))
            .bg(bg_now)
            .text_color(fg_now)
            .when(self.size == Size::Sm || self.size == Size::Xs, |b| b.text_sm())
            .font_weight(FontWeight::MEDIUM)
            .when(self.disabled, |b| b.opacity(0.5))
            .when_some(self.on_click, |b, handler| b.on_click(handler))
            .when_some(self.icon, |b, name| b.child(icon(name, icon_size).text_color(fg_now)))
            .children(self.leading)
            .when_some(self.label, |b, label| b.child(div().min_w_0().truncate().child(label)));
        let button = motion::track(button, &pointer);
        match self.tooltip {
            Some(tip) => button
                .tooltip(move |window, cx| Tooltip::new(tip.clone()).build(window, cx))
                .into_any_element(),
            None => button.into_any_element(),
        }
    }
}
