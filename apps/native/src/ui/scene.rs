// Scenes (spec 018 illustrations, apps/web/src/ui/face.tsx › Scene): a quiet card holding the moment's icon, a second
// card behind it, and one agent in the action blue docked on its corner whose eyes tell the mood. Neutrals plus the
// accent only; the face floats 3px (still under reduced motion). `empty` is a whole screen with nothing yet: the scene
// over a title and a hint, centred.
use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::{
        face::{AgentFace, Eyes},
        icon::icon,
        motion, space,
    },
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
    /// Its icon and the face's mood.
    fn look(self) -> (IconName, Eyes) {
        match self {
            Moment::AllClear => (IconName::Check, Eyes::Happy),
            Moment::Resting => (IconName::Moon, Eyes::Asleep),
            Moment::CalmDay => (IconName::Sun, Eyes::Happy),
            Moment::Clock => (IconName::Timer, Eyes::Asleep),
            Moment::Team => (IconName::Users, Eyes::Open),
            Moment::Notebook => (IconName::NotebookPen, Eyes::Up),
            Moment::Pages => (IconName::FileText, Eyes::Aside),
            Moment::Connect => (IconName::Plug, Eyes::Open),
            Moment::Search => (IconName::Search, Eyes::Aside),
            Moment::Offline => (IconName::Unplug, Eyes::Asleep),
            Moment::Lost => (IconName::Compass, Eyes::Up),
            Moment::Meter => (IconName::Gauge, Eyes::Happy),
            Moment::Chat => (IconName::MessageCircle, Eyes::Open),
        }
    }
}

const FLOAT_MS: u64 = 3200;

/// The scene, small (a row's 48px) or large (a page's 80px).
pub fn scene(id: impl Into<SharedString>, kind: Moment, large: bool, window: &Window, cx: &App) -> AnyElement {
    let p = theme::palette(window);
    let id: SharedString = id.into();
    let (glyph, eyes) = kind.look();
    let (boxed, back_r, card_r, glyph_size, face) = if large {
        (80., tokens::RADIUS_ROW, tokens::RADIUS_CARD, 28., 24.)
    } else {
        (48., tokens::RADIUS_CONTROL_SM, tokens::RADIUS_ROW, 18., 16.)
    };
    let face = div().absolute().right(px(-6.)).bottom(px(-6.)).child(
        AgentFace::new(ElementId::from(format!("{id}-face")), 0)
            .size(face)
            .eyes(eyes)
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
