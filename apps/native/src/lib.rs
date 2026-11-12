// Zorel's native desktop client (spec 019): the library the window (main.rs) and the integration tests share.
rust_i18n::i18n!("locales", fallback = "en");

pub mod app;
pub mod engine;
pub mod i18n;
pub mod net;
pub mod runtime;
pub mod state;
pub mod theme;
