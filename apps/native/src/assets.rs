// The app's assets: Zorel's own (the mark) first, then gpui-kit's bundled Lucide icons.
use std::borrow::Cow;

use gpui_kit::{AssetSource, Result, SharedString};

pub const LOGO: &str = "zorel/logo.svg";

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match path {
            LOGO => Ok(Some(Cow::Borrowed(include_bytes!("../assets/logo.svg")))),
            _ => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        gpui_kit::assets::Assets.list(path)
    }
}
