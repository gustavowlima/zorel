// Zorel's native desktop client (spec 019): the library the window (main.rs) and the integration tests share.
rust_i18n::i18n!("locales", fallback = "en");

pub mod app;
pub mod assets;
pub mod engine;
pub mod format;
pub mod i18n;
pub mod labels;
pub mod net;
pub mod route;
pub mod runtime;
pub mod screens;
pub mod shell;
pub mod state;
pub mod theme;
pub mod ui;
