// The local engine (spec 019 T017): the Bun server, started by this app as a child process, as Electron did.
// The per-launch secret is made here, handed to the server on stdin (never in the environment, which other processes
// of this user can read) and kept only in memory; the server binds 127.0.0.1 on a free port and exits on its own if
// this process dies (ZOREL_PARENT_PID). Ready = its routes answer: anything but a 404, a 401 included.
use std::{
    net::TcpListener,
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};

use tokio::{io::AsyncWriteExt, process::Child};

const READY_EVERY: Duration = Duration::from_millis(100);
// Room for macOS's keychain prompt on a new build's first launch.
const READY_WITHIN: Duration = Duration::from_secs(120);

/// How to start the server.
pub struct Launch {
    /// The command: `bun <repo>/apps/server/src/main.ts` in development, the compiled sidecar when packaged.
    pub program: PathBuf,
    pub args: Vec<String>,
    /// The data folder (ZOREL_HOME); None uses the server's default.
    pub home: Option<PathBuf>,
    /// Where the web build is (ZOREL_WEB_DIR), for the browser access the server keeps offering.
    pub web_dir: Option<PathBuf>,
}

impl Launch {
    /// Development: the server from this checkout, run by bun.
    pub fn dev(repo: PathBuf) -> Self {
        Self {
            program: PathBuf::from("bun"),
            args: vec![repo.join("apps/server/src/main.ts").to_string_lossy().into_owned()],
            home: None,
            web_dir: Some(repo.join("apps/web/dist")),
        }
    }
}

/// A running engine: where it is and the secret it accepts. Dropping it stops the server.
pub struct Engine {
    pub url: String,
    pub token: String,
    /// Held only so dropping the Engine kills the server (kill_on_drop).
    _child: Option<Child>,
}

#[derive(Debug)]
pub enum EngineError {
    Spawn(std::io::Error),
    NotReady,
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(e) => write!(f, "couldn't start the Zorel server: {e}"),
            Self::NotReady => write!(f, "the Zorel server didn't start in {} seconds", READY_WITHIN.as_secs()),
        }
    }
}

impl std::error::Error for EngineError {}

impl Engine {
    /// An engine someone else runs (`--engine <url> --token <t>`): attach, never stop it.
    pub fn attach(url: String, token: String) -> Self {
        Self {
            url,
            token,
            _child: None,
        }
    }

    /// Starts the server and waits until it answers.
    pub async fn start(launch: Launch) -> Result<Self, EngineError> {
        let port = free_port().map_err(EngineError::Spawn)?;
        let token = secret();
        let mut cmd = tokio::process::Command::new(&launch.program);
        cmd.args(&launch.args)
            .env("PORT", port.to_string())
            .env("ZOREL_SESSION_STDIN", "1")
            .env("ZOREL_PARENT_PID", std::process::id().to_string())
            .stdin(Stdio::piped())
            .kill_on_drop(true);
        if let Some(home) = &launch.home {
            cmd.env("ZOREL_HOME", home);
        }
        if let Some(web) = &launch.web_dir {
            cmd.env("ZOREL_WEB_DIR", web);
        }
        let mut child = cmd.spawn().map_err(EngineError::Spawn)?;
        let mut stdin = child.stdin.take().expect("stdin is piped");
        stdin
            .write_all(format!("{token}\n").as_bytes())
            .await
            .map_err(EngineError::Spawn)?;
        drop(stdin); // the server reads one line and the pipe closes

        let engine = Self {
            url: format!("http://127.0.0.1:{port}"),
            token,
            _child: Some(child),
        };
        engine.wait_ready().await?;
        Ok(engine)
    }

    async fn wait_ready(&self) -> Result<(), EngineError> {
        let http = reqwest::Client::new();
        let started = Instant::now();
        while started.elapsed() < READY_WITHIN {
            if let Ok(r) = http.get(format!("{}/", self.url)).send().await
                && r.status() != reqwest::StatusCode::NOT_FOUND
            {
                return Ok(());
            }
            tokio::time::sleep(READY_EVERY).await;
        }
        Err(EngineError::NotReady)
    }
}

// ponytail: kill_on_drop sends SIGKILL; the server's own SIGTERM cleanup (closing agents) is skipped. Send SIGTERM
// first and wait briefly once shutdown order matters (T046 single instance / quit).

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// 32 random bytes as hex (packages/contracts session.ts: SESSION_BYTES).
fn secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the system's random source");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_64_hex_and_fresh() {
        let (a, b) = (secret(), secret());
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
