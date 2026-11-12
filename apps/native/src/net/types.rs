// Every type that crosses the network, generated from the contract by build.rs (never hand-written: add the type to
// packages/contracts, run `bun run schema`, rebuild).
#![allow(clippy::all, dead_code)]
include!(concat!(env!("OUT_DIR"), "/wire.rs"));
