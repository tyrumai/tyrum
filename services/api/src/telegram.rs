use std::sync::Arc;

use axum::http::HeaderMap;
use hex::FromHex;
use hmac::digest::InvalidLength;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use thiserror::Error;

const SECRET_HEADER: &str = "X-Telegram-Bot-Api-Secret-Token";
const SIGNATURE_HEADER: &str = "X-Telegram-Bot-Api-Signature";
const SIGNATURE_PREFIX: &str = "sha256=";

#[derive(Clone)]
pub struct TelegramWebhookVerifier {
    inner: Arc<VerifierInner>,
}

struct VerifierInner {
    secret_bytes: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("telegram webhook secret may not be empty")]
    Empty,
    #[error("telegram webhook secret exceeds maximum length")]
    TooLong,
}

#[derive(Debug, Error)]
pub enum VerificationError {
    #[error("missing telegram secret token header")]
    MissingSecret,
    #[error("invalid telegram secret token header")]
    InvalidSecret,
    #[error("missing telegram signature header")]
    MissingSignature,
    #[error("signature header is not valid UTF-8")]
    MalformedSignature,
    #[error("telegram secret token mismatch")]
    SecretMismatch,
    #[error("telegram signature mismatch")]
    SignatureMismatch,
    #[error("signature header missing sha256 prefix")]
    MissingPrefix,
    #[error("failed to compute telegram signature")]
    SignatureComputationFailed(#[source] InvalidLength),
}

impl TelegramWebhookVerifier {
    pub fn new(secret: impl Into<String>) -> Result<Self, SecretError> {
        let raw = secret.into();
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(SecretError::Empty);
        }
        if trimmed.len() > 256 {
            return Err(SecretError::TooLong);
        }

        let secret_bytes = trimmed.as_bytes().to_vec();

        Ok(Self {
            inner: Arc::new(VerifierInner { secret_bytes }),
        })
    }

    pub fn verify(&self, headers: &HeaderMap, body: &[u8]) -> Result<(), VerificationError> {
        let provided_secret = headers
            .get(SECRET_HEADER)
            .ok_or(VerificationError::MissingSecret)?
            .to_str()
            .map_err(|_| VerificationError::InvalidSecret)?;

        if !constant_time_eq(provided_secret.as_bytes(), &self.inner.secret_bytes) {
            return Err(VerificationError::SecretMismatch);
        }

        let signature_header = headers
            .get(SIGNATURE_HEADER)
            .ok_or(VerificationError::MissingSignature)?
            .to_str()
            .map_err(|_| VerificationError::MalformedSignature)?;

        let signature = signature_header
            .strip_prefix(SIGNATURE_PREFIX)
            .ok_or(VerificationError::MissingPrefix)?;

        let provided =
            Vec::from_hex(signature).map_err(|_| VerificationError::MalformedSignature)?;
        if provided.is_empty() {
            return Err(VerificationError::MalformedSignature);
        }

        let expected = self.compute_signature(body)?;

        if constant_time_eq(&provided, &expected) {
            Ok(())
        } else {
            Err(VerificationError::SignatureMismatch)
        }
    }

    pub fn expected_signature_header(&self, body: &[u8]) -> Result<String, VerificationError> {
        let signature = self.compute_signature(body)?;
        Ok(format!("{SIGNATURE_PREFIX}{}", hex::encode(signature)))
    }

    fn compute_signature(&self, body: &[u8]) -> Result<Vec<u8>, VerificationError> {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.inner.secret_bytes)
            .map_err(VerificationError::SignatureComputationFailed)?;
        mac.update(body);
        Ok(mac.finalize().into_bytes().to_vec())
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    let mut result = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        result |= a ^ b;
    }

    result == 0
}

#[cfg(test)]
mod tests {
    use super::{SIGNATURE_PREFIX, TelegramWebhookVerifier, VerificationError};
    use axum::http::{HeaderMap, HeaderValue};

    const SECRET: &str = "test-secret-123";
    const PAYLOAD: &str = r#"{"update_id": 12345, "message": {"message_id": 1}}"#;

    fn headers(signature: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("X-Telegram-Bot-Api-Secret-Token", header_value(SECRET));
        headers.insert("X-Telegram-Bot-Api-Signature", header_value(signature));
        headers
    }

    fn header_value(value: &str) -> HeaderValue {
        match value.parse() {
            Ok(parsed) => parsed,
            Err(err) => panic!("invalid header value: {err}"),
        }
    }

    fn verifier() -> TelegramWebhookVerifier {
        match TelegramWebhookVerifier::new(SECRET) {
            Ok(verifier) => verifier,
            Err(err) => panic!("failed to construct verifier: {err}"),
        }
    }

    #[test]
    fn verifier_accepts_valid_signature() {
        let verifier = verifier();
        let signature = match verifier.expected_signature_header(PAYLOAD.as_bytes()) {
            Ok(value) => value,
            Err(err) => panic!("expected signature header: {err}"),
        };
        let headers = headers(&signature);

        assert!(verifier.verify(&headers, PAYLOAD.as_bytes()).is_ok());
    }

    #[test]
    fn verifier_rejects_bad_signature() {
        let verifier = verifier();
        let mut headers = headers("sha256=deadbeef");

        let error = match verifier.verify(&headers, PAYLOAD.as_bytes()) {
            Ok(_) => panic!("expected signature mismatch"),
            Err(err) => err,
        };
        assert!(matches!(error, VerificationError::SignatureMismatch));

        headers.insert("X-Telegram-Bot-Api-Signature", header_value("sha256="));
        let error = match verifier.verify(&headers, PAYLOAD.as_bytes()) {
            Ok(_) => panic!("expected malformed signature"),
            Err(err) => err,
        };
        assert!(matches!(error, VerificationError::MalformedSignature));
    }

    #[test]
    fn verifier_rejects_secret_mismatch() {
        let verifier = verifier();
        let signature = match verifier.expected_signature_header(PAYLOAD.as_bytes()) {
            Ok(value) => value,
            Err(err) => panic!("expected signature header: {err}"),
        };
        let mut headers = headers(&signature);
        headers.insert("X-Telegram-Bot-Api-Secret-Token", header_value("wrong"));

        let error = match verifier.verify(&headers, PAYLOAD.as_bytes()) {
            Ok(_) => panic!("expected secret mismatch"),
            Err(err) => err,
        };
        assert!(matches!(error, VerificationError::SecretMismatch));
    }

    #[test]
    fn verifier_accepts_uppercase_signature() {
        let verifier = verifier();
        let signature = match verifier.expected_signature_header(PAYLOAD.as_bytes()) {
            Ok(value) => value,
            Err(err) => panic!("expected signature header: {err}"),
        };
        let digest_upper = signature[SIGNATURE_PREFIX.len()..].to_uppercase();
        let uppercase = format!("{SIGNATURE_PREFIX}{digest_upper}");
        let headers = headers(&uppercase);

        assert!(verifier.verify(&headers, PAYLOAD.as_bytes()).is_ok());
    }
}
