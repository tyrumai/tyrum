//! Deterministic risk classifier stub used by the planner to score spend intents.

mod classifier;
mod config;
pub mod http;

pub use classifier::{RiskClassifier, RiskInput, RiskLevel, RiskVerdict, SpendContext};
pub use config::{RiskConfig, RiskConfigError};

/// Load a classifier by reading a configuration file from disk.
///
/// # Errors
/// Returns [`RiskConfigError`] when the file cannot be read or parsed into a
/// valid [`RiskConfig`].
pub fn load_classifier_from_path(
    path: impl AsRef<std::path::Path>,
) -> Result<RiskClassifier, RiskConfigError> {
    let config = config::load_from_path(path)?;
    Ok(RiskClassifier::new(config))
}

/// Load a classifier from a TOML configuration string.
///
/// # Errors
/// Returns [`RiskConfigError`] when the supplied string cannot be parsed into
/// a valid [`RiskConfig`].
pub fn load_classifier_from_toml_str(raw: &str) -> Result<RiskClassifier, RiskConfigError> {
    let config = config::from_toml_str(raw)?;
    Ok(RiskClassifier::new(config))
}

/// Load a classifier from a YAML configuration string.
///
/// # Errors
/// Returns [`RiskConfigError`] when the supplied string cannot be parsed into
/// a valid [`RiskConfig`].
pub fn load_classifier_from_yaml_str(raw: &str) -> Result<RiskClassifier, RiskConfigError> {
    let config = config::from_yaml_str(raw)?;
    Ok(RiskClassifier::new(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifier_defaults_to_low_risk() {
        let config = RiskConfig::default();
        let classifier = RiskClassifier::new(config);
        let verdict = classifier.classify(&RiskInput::default());
        assert_eq!(verdict.level, RiskLevel::Low);
        assert!(verdict.confidence > 0.0);
        assert!(verdict.reasons.is_empty());
    }
}
