use reqwest::{Client, StatusCode, Url};
use thiserror::Error;

use tyrum_wallet::{MerchantContext, SpendAuthorizeRequest, SpendAuthorizeResponse};

/// Input parameters required to authorize a spend with the wallet service.
#[derive(Clone, Debug)]
pub struct SpendAuthorization {
    pub request_id: Option<String>,
    pub amount_minor_units: u64,
    pub currency: String,
    pub merchant_name: Option<String>,
}

/// Thin async client for the Tyrum wallet authorization service.
#[derive(Clone)]
pub struct WalletClient {
    http: Client,
    base_url: Url,
}

impl WalletClient {
    /// Construct a wallet client targeting the provided base URL.
    ///
    /// # Panics
    ///
    /// Panics if the underlying HTTP client cannot be constructed.
    #[must_use]
    pub fn new(base_url: Url) -> Self {
        let http = match Client::builder().user_agent("tyrum-planner").build() {
            Ok(client) => client,
            Err(err) => panic!("construct wallet client: {err}"),
        };

        Self { http, base_url }
    }

    /// Execute an authorization call against the wallet service.
    ///
    /// # Errors
    ///
    /// Returns a [`WalletClientError`] when URL construction, transport, or decoding fails or
    /// when the wallet returns a non-success HTTP status.
    pub async fn authorize(
        &self,
        payload: &SpendAuthorization,
    ) -> Result<SpendAuthorizeResponse, WalletClientError> {
        let url = self
            .base_url
            .join("/spend/authorize")
            .map_err(|error| WalletClientError::InvalidUrl { error })?;

        let merchant = payload.merchant_name.as_ref().map(|name| MerchantContext {
            name: Some(name.clone()),
            ..MerchantContext::default()
        });

        let request = SpendAuthorizeRequest {
            request_id: payload.request_id.clone(),
            card_id: None,
            amount_minor_units: payload.amount_minor_units,
            currency: payload.currency.clone(),
            merchant,
        };

        let response = self
            .http
            .post(url)
            .json(&request)
            .send()
            .await
            .map_err(|error| WalletClientError::Transport { error })?;

        if !response.status().is_success() {
            let status = response.status();
            return Err(WalletClientError::UnexpectedStatus { status });
        }

        response
            .json::<SpendAuthorizeResponse>()
            .await
            .map_err(|error| WalletClientError::Decode { error })
    }
}

/// Errors surfaced when calling the wallet authorization service.
#[derive(Debug, Error)]
pub enum WalletClientError {
    #[error("invalid wallet URL: {error}")]
    InvalidUrl { error: url::ParseError },
    #[error("wallet transport error: {error}")]
    Transport { error: reqwest::Error },
    #[error("wallet returned unexpected status {status}")]
    UnexpectedStatus { status: StatusCode },
    #[error("failed to decode wallet response: {error}")]
    Decode { error: reqwest::Error },
}

pub use tyrum_wallet::AuthorizationDecision;
