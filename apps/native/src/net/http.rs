// HTTP to the engine (spec 019 T018): the contract's REST routes, with the session secret on every request. Local
// engine only for now; team servers bring their own credential (T047).
use serde::{Serialize, de::DeserializeOwned};

use crate::engine::Engine;

pub const SESSION_HEADER: &str = "x-zorel-token"; // packages/contracts session.ts
const ATTACHMENT_NAME_HEADER: &str = "x-file-name"; // packages/contracts routes.ts

#[derive(Clone)]
pub struct Http {
    base: String,
    client: reqwest::Client,
    /// The session secret, for sockets (a terminal) that can't share the client's headers.
    token: String,
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
            token: engine.token.clone(),
        }
    }

    /// A WebSocket request to the engine's `path` (with its query), carrying the session secret.
    pub fn socket(&self, path: &str) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
        use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue};
        let url = format!("{}{path}", self.base.replacen("http", "ws", 1));
        let mut req = url.into_client_request().map_err(|e| e.to_string())?;
        let mut secret = HeaderValue::from_str(&self.token).map_err(|e| e.to_string())?;
        secret.set_sensitive(true);
        req.headers_mut().insert(SESSION_HEADER, secret);
        Ok(req)
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, HttpError> {
        Self::read(self.client.get(format!("{}{path}", self.base)).send().await).await
    }

    /// A file's bytes as the engine serves it (an attachment).
    pub async fn bytes(&self, path: &str) -> Result<Vec<u8>, HttpError> {
        let response = self
            .client
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .map_err(HttpError::Network)?;
        let status = response.status();
        if !status.is_success() {
            return Err(HttpError::Status(status, response.text().await.unwrap_or_default()));
        }
        response.bytes().await.map(|b| b.to_vec()).map_err(HttpError::Network)
    }

    pub async fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, HttpError> {
        Self::read(self.client.post(format!("{}{path}", self.base)).json(body).send().await).await
    }

    pub async fn patch<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, HttpError> {
        Self::read(
            self.client
                .patch(format!("{}{path}", self.base))
                .json(body)
                .send()
                .await,
        )
        .await
    }

    pub async fn put<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, HttpError> {
        Self::read(self.client.put(format!("{}{path}", self.base)).json(body).send().await).await
    }

    /// A file's raw bytes (an attachment): its name travels URI-encoded in `x-file-name`, as the web sends it.
    pub async fn upload<T: DeserializeOwned>(
        &self,
        path: &str,
        name: &str,
        mime: &str,
        bytes: Vec<u8>,
    ) -> Result<T, HttpError> {
        Self::read(
            self.client
                .post(format!("{}{path}", self.base))
                .header("content-type", mime)
                .header(ATTACHMENT_NAME_HEADER, uri_encode(name))
                .body(bytes)
                .send()
                .await,
        )
        .await
    }

    /// DELETE; the engine answers 204 or a small JSON body, neither read.
    pub async fn delete(&self, path: &str) -> Result<(), HttpError> {
        let response = self
            .client
            .delete(format!("{}{path}", self.base))
            .send()
            .await
            .map_err(HttpError::Network)?;
        match response.status() {
            s if s.is_success() => Ok(()),
            s => Err(HttpError::Status(s, response.text().await.unwrap_or_default())),
        }
    }

    async fn read<T: DeserializeOwned>(sent: reqwest::Result<reqwest::Response>) -> Result<T, HttpError> {
        let response = sent.map_err(HttpError::Network)?;
        let status = response.status();
        if !status.is_success() {
            return Err(HttpError::Status(status, response.text().await.unwrap_or_default()));
        }
        // An empty body (204, or a route that answers nothing) reads as JSON null, so `()`/`Value` callers don't fail.
        let body = response.bytes().await.map_err(HttpError::Network)?;
        let text = if body.is_empty() { &b"null"[..] } else { &body[..] };
        serde_json::from_slice(text).map_err(|e| HttpError::Status(status, format!("bad JSON: {e}")))
    }
}

/// JavaScript's encodeURIComponent: what the engine decodes the file name with.
pub fn uri_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::uri_encode;

    #[test]
    fn names_are_encoded_like_encode_uri_component() {
        assert_eq!(
            uri_encode("relatório final (v2).pdf"),
            "relat%C3%B3rio%20final%20(v2).pdf"
        );
    }
}
