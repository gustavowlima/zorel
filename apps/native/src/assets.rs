// The app's assets: Zorel's own (the mark), the Lucide icons Zorel's screens use beyond the kit's defaults (embedded
// one by one: add a name here when a screen needs a new icon), then gpui-kit's default icons.
use std::borrow::Cow;

use gpui_kit::{AssetSource, Result, SharedString, assets::icon_assets};

pub const LOGO: &str = "zorel/logo.svg";

/// The providers' marks (assets/providers, single colour), by asset path.
const PROVIDERS: [(&str, &[u8]); 8] = [
    ("providers/claude.svg", include_bytes!("../assets/providers/claude.svg")),
    ("providers/codex.svg", include_bytes!("../assets/providers/codex.svg")),
    ("providers/gemini.svg", include_bytes!("../assets/providers/gemini.svg")),
    (
        "providers/opencode.svg",
        include_bytes!("../assets/providers/opencode.svg"),
    ),
    (
        "providers/openrouter.svg",
        include_bytes!("../assets/providers/openrouter.svg"),
    ),
    ("providers/ollama.svg", include_bytes!("../assets/providers/ollama.svg")),
    (
        "providers/antigravity.svg",
        include_bytes!("../assets/providers/antigravity.svg"),
    ),
    (
        "providers/lmstudio.svg",
        include_bytes!("../assets/providers/lmstudio.svg"),
    ),
];

/// A provider's mark for a provider or a model id's prefix ("claude-cli" → claude); None for one without a mark.
pub fn provider_mark(provider: &str) -> Option<&'static str> {
    const ALIASES: [(&str, &str); 5] = [
        ("claude-cli", "claude"),
        ("anthropic", "claude"),
        ("codex-cli", "codex"),
        ("openai", "codex"),
        ("gemini-cli", "gemini"),
    ];
    let key = ALIASES
        .iter()
        .find(|(a, _)| *a == provider)
        .map_or(provider, |(_, k)| k);
    PROVIDERS
        .iter()
        .map(|(path, _)| *path)
        .find(|path| path.strip_prefix("providers/").and_then(|p| p.strip_suffix(".svg")) == Some(key))
}

icon_assets!(
    ZorelIcons,
    [
        House,
        AlarmClock,
        Clock,
        Brain,
        MessageCircle,
        Plug,
        MousePointerClick,
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
        Close,
        Box,
        Pencil,
        Wrench,
        Sparkles,
        Minimize2,
        SquarePen,
        GripVertical,
        Trash,
        CornerDownRight,
        Shield,
        GitBranch,
        LayoutGrid,
        GitPullRequest,
        ShieldAlert,
        X,
        X
    ]
);

/// Lucide draws at stroke 2; Zorel's icons are one stroke, 1.6 (prototype `.ic`, --z-icon-stroke), whoever ships them.
fn thin(svg: Cow<'static, [u8]>) -> Cow<'static, [u8]> {
    match std::str::from_utf8(&svg) {
        Ok(text) if text.contains(STROKE_2) => Cow::Owned(text.replace(STROKE_2, STROKE).into_bytes()),
        _ => svg,
    }
}
const STROKE_2: &str = "stroke-width=\"2\"";
const STROKE: &str = "stroke-width=\"1.6\"";

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if path == LOGO {
            return Ok(Some(Cow::Borrowed(include_bytes!("../assets/logo.svg"))));
        }
        if let Some(mark) = PROVIDERS.iter().find(|(p, _)| *p == path).map(|(_, bytes)| *bytes) {
            return Ok(Some(Cow::Borrowed(mark)));
        }
        let bytes = match ZorelIcons.load(path)? {
            Some(bytes) => Some(bytes),
            None => gpui_kit::assets::Assets.load(path)?,
        };
        Ok(bytes.map(|b| if path.starts_with("icons/") { thin(b) } else { b }))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut all = ZorelIcons.list(path)?;
        all.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(all)
    }
}

#[cfg(test)]
mod tests {
    use gpui_kit::AssetSource as _;

    #[test]
    fn icons_are_drawn_at_zorels_stroke() {
        let svg = super::Assets.load("icons/plus.svg").unwrap().unwrap();
        let text = std::str::from_utf8(&svg).unwrap();
        assert!(text.contains("stroke-width=\"1.6\"") && !text.contains("stroke-width=\"2\""));
    }
}
