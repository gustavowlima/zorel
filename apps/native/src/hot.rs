// Hot-patching in development (`bun run native:hot`, feature `hotreload`): Subsecond swaps function bodies in the
// running app. A view's render goes through `hot::call` so the new body runs on the next frame, and every patch asks
// the windows to redraw. Without the feature, `call` is a plain call and nothing else exists.

/// Runs `f` through Subsecond's jump table (the patched version, if any).
#[inline(always)]
pub fn call<O>(f: impl FnMut() -> O) -> O {
    #[cfg(feature = "hotreload")]
    {
        subsecond::call(f)
    }
    #[cfg(not(feature = "hotreload"))]
    {
        let mut f = f;
        f()
    }
}

/// Connects to `dx`'s devserver and redraws every window when a patch lands.
#[cfg(feature = "hotreload")]
pub fn install(cx: &mut gpui_kit::App) {
    let (patched, mut patches) = tokio::sync::mpsc::unbounded_channel::<()>();
    subsecond::register_handler(std::sync::Arc::new(move || {
        let _ = patched.send(());
    }));
    dioxus_devtools::connect_subsecond();
    cx.spawn(async move |cx| {
        while patches.recv().await.is_some() {
            let _ = cx.update(|cx| cx.refresh_windows());
        }
    })
    .detach();
}
