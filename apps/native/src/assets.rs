// The app's assets: Zorel's own (the mark), the Lucide icons Zorel's screens use beyond the kit's defaults (embedded
// one by one: add a name here when a screen needs a new icon), then gpui-kit's default icons.
use std::borrow::Cow;

use gpui_kit::{AssetSource, Result, SharedString, assets::icon_assets};

pub const LOGO: &str = "zorel/logo.svg";

icon_assets!(
    ZorelIcons,
    [
        House,
        AlarmClock,
        Brain,
        MessageCircle,
        PanelLeftClose,
        PanelLeftOpen,
        Bot,
        Pause,
        Play,
        Gauge,
        Folder,
        Users,
        ArrowUp,
        ChartColumn,
        RefreshCw,
        Settings,
        File,
        Close
    ]
);

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if path == LOGO {
            return Ok(Some(Cow::Borrowed(include_bytes!("../assets/logo.svg"))));
        }
        match ZorelIcons.load(path)? {
            Some(bytes) => Ok(Some(bytes)),
            None => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut all = ZorelIcons.list(path)?;
        all.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(all)
    }
}
