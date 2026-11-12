// The palette (⌘K / Ctrl K, the sidebar's search; apps/web/src/features/palette.tsx): go to a place, a project or a
// chat by typing, or run a quick action (new chat, show or hide the sidebar). The kit's Command in a dialog: search,
// groups, arrows and Enter, Escape closes.
// ponytail: searching inside messages ("In messages") needs /api/search results in the list; it comes with the
// chat screen's search.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::{
        WindowExt as _,
        command::{Command, CommandGroup, CommandItem, CommandState},
    },
    *,
};
use rust_i18n::t;

use crate::{labels::chat_title, route::Route, state::store::Store};

/// What a palette row does.
#[derive(Clone)]
pub enum Target {
    Go(Route),
    ToggleSidebar,
}

pub type OnPick = Rc<dyn Fn(Target, &mut Window, &mut App) + 'static>;

/// A row: its label, icon and what it does.
type Entry = (String, IconName, Target);

/// Opens the palette over the window.
pub fn open(store: &Entity<Store>, on_pick: OnPick, window: &mut Window, cx: &mut App) {
    let state = cx.new(|cx| CommandState::new(window, cx));
    let s = store.read(cx);
    // Groups and their targets, in the same order (on_confirm gives back section and row).
    let go = vec![
        (
            t!("nav.homeScreen").into_owned(),
            IconName::House,
            Target::Go(Route::Home { project_id: None }),
        ),
        (
            t!("nav.needsYou").into_owned(),
            IconName::Inbox,
            Target::Go(Route::Inbox),
        ),
        (
            t!("nav.newChat").into_owned(),
            IconName::Plus,
            Target::Go(Route::Home { project_id: None }),
        ),
        (
            t!("palette.toggleSidebar").into_owned(),
            IconName::PanelLeftClose,
            Target::ToggleSidebar,
        ),
    ];
    let projects: Vec<Entry> = s
        .projects
        .iter()
        .map(|p| {
            (
                p.name.clone(),
                IconName::Folder,
                Target::Go(Route::Home {
                    project_id: Some(p.id.clone()),
                }),
            )
        })
        .collect();
    let chats: Vec<Entry> = s
        .chats
        .chats
        .iter()
        .filter(|c| c.parent_id.is_none())
        .map(|c| {
            (
                chat_title(c),
                IconName::MessageCircle,
                Target::Go(Route::Chat { id: c.id.clone() }),
            )
        })
        .collect();
    let groups: Vec<(String, Vec<Entry>)> = vec![
        (t!("palette.go").into_owned(), go),
        (t!("nav.projects").into_owned(), projects),
        (t!("nav.chats").into_owned(), chats),
    ]
    .into_iter()
    .filter(|(_, items)| !items.is_empty())
    .collect();
    let targets: Rc<Vec<Vec<Target>>> = Rc::new(
        groups
            .iter()
            .map(|(_, items)| items.iter().map(|(_, _, t)| t.clone()).collect())
            .collect(),
    );
    let groups = Rc::new(groups);
    window.open_dialog(cx, move |dialog, _, _| {
        let (state, groups, targets, on_pick) = (state.clone(), groups.clone(), targets.clone(), on_pick.clone());
        dialog.close_button(false).p_0().content(move |content, _, _| {
            let (targets, on_pick) = (targets.clone(), on_pick.clone());
            let mut command = Command::new(&state)
                .bordered(false)
                .placeholder(t!("palette.placeholder").into_owned());
            for (label, items) in groups.iter() {
                command = command.group(
                    CommandGroup::new().label(label.clone()).items(
                        items
                            .iter()
                            .map(|(name, icon, _)| CommandItem::new().label(name.clone()).icon(*icon)),
                    ),
                );
            }
            content.child(command.on_confirm(move |at, window, cx| {
                if let Some(target) = targets.get(at.section).and_then(|g| g.get(at.row)).cloned() {
                    window.close_dialog(cx);
                    on_pick(target, window, cx);
                }
            }))
        })
    });
}
