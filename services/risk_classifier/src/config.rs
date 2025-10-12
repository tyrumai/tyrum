use std::{collections::HashMap, fs, path::Path};

use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Clone, Deserialize)]
pub struct RiskConfig {
    #[serde(default = "default_confidence")]
    pub baseline_confidence: f32,
    #[serde(default = "default_medium_threshold")]
    pub tag_medium_threshold: f32,
    #[serde(default = "default_high_threshold")]
    pub tag_high_threshold: f32,
    #[serde(default)]
    pub tag_weights: HashMap<String, f32>,
    #[serde(default)]
    pub spend_thresholds: HashMap<String, SpendThreshold>,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            baseline_confidence: default_confidence(),
            tag_medium_threshold: default_medium_threshold(),
            tag_high_threshold: default_high_threshold(),
            tag_weights: HashMap::new(),
            spend_thresholds: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpendThreshold {
    pub caution_minor_units: u64,
    pub high_minor_units: u64,
}

impl SpendThreshold {
    pub fn normalized(&self) -> Self {
        let caution = self.caution_minor_units.min(self.high_minor_units);
        let high = self.caution_minor_units.max(self.high_minor_units);
        Self {
            caution_minor_units: caution,
            high_minor_units: high,
        }
    }
}

#[derive(Debug, Error)]
pub enum RiskConfigError {
    #[error("read config file: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse config as TOML: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("parse config as YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("unsupported config format: {0}")]
    UnsupportedFormat(String),
}

pub fn load_from_path(path: impl AsRef<Path>) -> Result<RiskConfig, RiskConfigError> {
    let path_ref = path.as_ref();
    let raw = fs::read_to_string(path_ref)?;
    let extension = path_ref
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "yml" | "yaml" => from_yaml_str(&raw),
        "toml" => from_toml_str(&raw),
        "" => match from_toml_str(&raw) {
            Ok(config) => Ok(config),
            Err(toml_err) => match from_yaml_str(&raw) {
                Ok(config) => Ok(config),
                Err(yaml_err) => Err(RiskConfigError::UnsupportedFormat(format!(
                    "failed to parse as TOML ({toml_err}) or YAML ({yaml_err})"
                ))),
            },
        },
        other => Err(RiskConfigError::UnsupportedFormat(other.into())),
    }
}

pub fn from_toml_str(raw: &str) -> Result<RiskConfig, RiskConfigError> {
    toml::from_str::<RiskConfig>(raw)
        .map(normalize_config)
        .map_err(RiskConfigError::from)
}

pub fn from_yaml_str(raw: &str) -> Result<RiskConfig, RiskConfigError> {
    serde_yaml::from_str::<RiskConfig>(raw)
        .map(normalize_config)
        .map_err(RiskConfigError::from)
}

fn normalize_config(mut config: RiskConfig) -> RiskConfig {
    if config.tag_high_threshold < config.tag_medium_threshold {
        std::mem::swap(
            &mut config.tag_high_threshold,
            &mut config.tag_medium_threshold,
        );
    }

    for threshold in config.spend_thresholds.values_mut() {
        let normalized = threshold.normalized();
        threshold.caution_minor_units = normalized.caution_minor_units;
        threshold.high_minor_units = normalized.high_minor_units;
    }

    config
}

const fn default_confidence() -> f32 {
    0.35
}

const fn default_medium_threshold() -> f32 {
    0.3
}

const fn default_high_threshold() -> f32 {
    0.6
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;

    #[test]
    fn parses_toml_config() {
        let raw = r#"
baseline_confidence = 0.4
tag_medium_threshold = 0.25
tag_high_threshold = 0.7

[tag_weights]
"risk:travel" = 0.2

[spend_thresholds.USD]
caution_minor_units = 50000
high_minor_units = 100000
"#;

        let config = from_toml_str(raw).expect("parse toml");
        assert!((config.baseline_confidence - 0.4).abs() < f32::EPSILON);
        assert!(config.tag_weights.contains_key("risk:travel"));
        assert_eq!(
            config
                .spend_thresholds
                .get("USD")
                .expect("usd threshold")
                .high_minor_units,
            100_000
        );
    }

    #[test]
    fn swaps_thresholds_when_high_below_caution() {
        let raw = r#"
[spend_thresholds.GBP]
caution_minor_units = 120000
high_minor_units = 60000
"#;

        let config = from_toml_str(raw).expect("parse toml");
        let gbp = config.spend_thresholds.get("GBP").expect("gbp threshold");
        assert_eq!(gbp.caution_minor_units, 60_000);
        assert_eq!(gbp.high_minor_units, 120_000);
    }
}
