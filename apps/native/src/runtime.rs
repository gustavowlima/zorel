// The tokio runtime the network runs on (spec 019 T021). GPUI has its own executors; network futures run here and the
// GPUI side awaits their JoinHandle (a plain future, fine on any executor). Zed's gpui_tokio does the same, but it's
// built against Zed's in-tree gpui, not the gpui-pre snapshot this app uses.
use std::{future::Future, sync::LazyLock};

use tokio::runtime::Runtime;

static RUNTIME: LazyLock<Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2) // a client: a couple of sockets and requests, nothing CPU-bound
        .enable_all()
        .thread_name("zorel-net")
        .build()
        .expect("the network runtime")
});

/// Runs a future on the network runtime; awaiting the handle gives its output (Err only if it panicked).
pub fn spawn<F>(future: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    RUNTIME.spawn(future)
}
