// Something fetched from the engine once: coming, here, or it couldn't be (so a failure shows, instead of loading
// forever).

#[derive(Clone)]
pub enum Remote<T> {
    Loading,
    Ready(T),
    Failed,
}
