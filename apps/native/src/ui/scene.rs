// Scenes (spec 018 illustrations, apps/web/src/ui/face.tsx › Scene): a quiet card holding the moment's icon, a second
// card behind it, and one agent in the action blue docked on its corner. Neutrals plus the
// accent only; the face floats 3px (still under reduced motion). `empty` is a whole screen with nothing yet: the scene
// over a title and a hint, centred.
use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::{face::AgentFace, icon::icon, motion, space},
};

/// The moment a screen is in when it has nothing to show.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Moment {
    AllClear,
    Resting,
    CalmDay,
    Clock,
    Team,
    Notebook,
    Pages,
    Connect,
    Search,
    Offline,
    Lost,
    Meter,
    Chat,
}

impl Moment {
    /// Its icon.
    fn icon(self) -> IconName {
        match self {
            Moment::AllClear => IconName::Check,
            Moment::Resting => IconName::Moon,
            Moment::CalmDay => IconName::Sun,
            Moment::Clock => IconName::Timer,
            Moment::Team => IconName::Users,
            Moment::Notebook => IconName::NotebookPen,
            Moment::Pages => IconName::FileText,
            Moment::Connect => IconName::Plug,
            Moment::Search => IconName::Search,
            Moment::Offline => IconName::Unplug,
            Moment::Lost => IconName::Compass,
            Moment::Meter => IconName::Gauge,
            Moment::Chat => IconName::MessageCircle,
        }
    }
}

const FLOAT_MS: u64 = 3200;

/// The scene, small (a row's 48px) or large (a page's 80px).
pub fn scene(id: impl Into<SharedString>, kind: Moment, large: bool, window: &Window, cx: &App) -> AnyElement {
    let p = theme::palette(window);
    let id: SharedString = id.into();
    let glyph = kind.icon();
    let (boxed, back_r, card_r, glyph_size, face) = if large {
        (80., tokens::RADIUS_ROW, tokens::RADIUS_CARD, 28., 24.)
    } else {
        (48., tokens::RADIUS_CONTROL_SM, tokens::RADIUS_ROW, 18., 16.)
    };
    let face = div().absolute().right(px(-6.)).bottom(px(-6.)).child(
        AgentFace::new(ElementId::from(format!("{id}-face")), 0)
            .size(face)
            .solid(p.accent, p.bg_canvas),
    );
    let face: AnyElement = if cx.reduce_motion() {
        face.into_any_element()
    } else {
        face.with_animation(
            ElementId::from(format!("{id}-float")),
            Animation::new(motion::ms(FLOAT_MS)).repeat(),
            |f, t| f.bottom(px(-6. + 3. * (t * std::f32::consts::TAU).sin().abs())),
        )
        .into_any_element()
    };
    div()
        .relative()
        .flex_none()
        .size(px(boxed))
        // The card behind.
        .child(
            div()
                .absolute()
                .left(relative(0.18))
                .right(relative(0.18))
                .top_0()
                .h(relative(0.5))
                .rounded(px(back_r))
                .bg(p.bg_surface)
                .border_1()
                .border_color(p.border),
        )
        // The card holding the moment's icon.
        .child(
            div()
                .absolute()
                .left_0()
                .right_0()
                .top(relative(0.14))
                .bottom_0()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(card_r))
                .bg(p.bg_raised)
                .border_1()
                .border_color(p.border_strong)
                .child(icon(glyph, glyph_size).text_color(p.text_secondary)),
        )
        .child(face)
        .into_any_element()
}

/// A whole screen with nothing yet: the scene, a title and a hint, centred.
pub fn empty(
    id: impl Into<SharedString>,
    kind: Moment,
    title: impl Into<SharedString>,
    hint: Option<SharedString>,
    window: &Window,
    cx: &App,
) -> Div {
    let p = theme::palette(window);
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(space::X2))
        .px(px(space::X6))
        .py(px(space::X12))
        .text_center()
        .child(div().mb(px(space::X4)).child(scene(id, kind, true, window, cx)))
        .child(
            div()
                .font_weight(FontWeight::MEDIUM)
                .text_color(p.text)
                .child(title.into()),
        )
        .when_some(hint, |d, h| {
            d.child(div().max_w(px(384.)).text_color(p.text_muted).child(h))
        })
}

/// An empty list inside a section: a dashed card the size of a row with the small scene, not a page's centred block.
pub fn inset(
    id: impl Into<SharedString>,
    kind: Moment,
    title: impl Into<SharedString>,
    hint: Option<SharedString>,
    window: &Window,
    cx: &App,
) -> Div {
    let p = theme::palette(window);
    div()
        .flex()
        .items_center()
        .gap(px(space::X3))
        .px(px(space::X4))
        .py(px(14.))
        .rounded(px(tokens::RADIUS_CARD))
        .border_1()
        .border_dashed()
        .border_color(p.border)
        .child(scene(id, kind, false, window, cx))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(p.text)
                        .child(title.into()),
                )
                .when_some(hint, |d, h| d.child(div().text_sm().text_color(p.text_muted).child(h))),
        )
}
