// HTTP to the engine (spec 019 T018): the contract's REST routes, with the session secret on every request. Local
// engine only for now; team servers bring their own credential (T047).
use serde::{Serialize, de::DeserializeOwned};

use crate::engine::Engine;

pub const SESSION_HEADER: &str = "x-zorel-token"; // packages/contracts session.ts

#[derive(Clone)]
pub struct Http {
    base: String,
    client: reqwest::Client,
}

#[derive(Debug)]
pub enum HttpError {
    Network(reqwest::Error),
    /// The engine answered with an error status (its JSON body, when there is one, carries the code).
    Status(reqwest::StatusCode, String),
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(e) => write!(f, "{e}"),
            Self::Status(s, body) => write!(f, "{s}: {body}"),
        }
    }
}

impl std::error::Error for HttpError {}

impl Http {
    pub fn new(engine: &Engine) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        let mut token = reqwest::header::HeaderValue::from_str(&engine.token).expect("the secret is hex");
        token.set_sensitive(true);
        headers.insert(SESSION_HEADER, token);
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .expect("an HTTP client");
        Self {
            base: engine.url.clone(),
            client,
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, HttpError> {
        Self::read(self.client.get(format!("{}{path}", self.base)).send().await).await
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, HttpError> {
        Self::read(self.client.post(format!("{}{path}", self.base)).json(body).send().await).await
    }

    async fn read<T: DeserializeOwned>(sent: reqwest::Result<reqwest::Response>) -> Result<T, HttpError> {
        let response = sent.map_err(HttpError::Network)?;
        let status = response.status();
        if !status.is_success() {
            return Err(HttpError::Status(status, response.text().await.unwrap_or_default()));
        }
        response.json().await.map_err(HttpError::Network)
    }
}
