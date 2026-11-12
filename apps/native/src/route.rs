// Where the main area is (the web's Route, apps/web/src/state.ts): only the screens the native client has.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Route {
    /// Home, for everything or one project.
    Home {
        project_id: Option<String>,
    },
    /// Needs you.
    Inbox,
    Chat {
        id: String,
    },
}

impl Default for Route {
    fn default() -> Self {
        Self::Home { project_id: None }
    }
}
