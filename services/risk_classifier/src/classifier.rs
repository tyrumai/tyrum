use std::{cmp::Ordering, sync::Arc};

use serde::Serialize;

use crate::config::{RiskConfig, SpendThreshold};

#[derive(Debug, Clone)]
pub struct RiskClassifier {
    config: Arc<RiskConfig>,
}

impl RiskClassifier {
    #[must_use]
    pub fn new(config: RiskConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    #[must_use]
    pub fn classify(&self, input: &RiskInput) -> RiskVerdict {
        let mut level = RiskLevel::Low;
        let mut score = 0.0;
        let mut reasons = Vec::new();

        if let Some(spend) = &input.spend {
            let currency = spend.currency.to_uppercase();
            if let Some(threshold) = self.config.spend_thresholds.get(&currency) {
                let normalized = threshold_normalized(threshold);
                let amount = spend.amount_minor_units;
                match amount.cmp(&normalized.high_minor_units) {
                    Ordering::Greater | Ordering::Equal => {
                        level = RiskLevel::High;
                        score += 0.4;
                        reasons.push(format!(
                            "amount {} {} exceeds high threshold {}",
                            amount, currency, normalized.high_minor_units
                        ));
                    }
                    Ordering::Less => {
                        if amount >= normalized.caution_minor_units {
                            level = level.max(RiskLevel::Medium);
                            score += 0.25;
                            reasons.push(format!(
                                "amount {} {} exceeds caution threshold {}",
                                amount, currency, normalized.caution_minor_units
                            ));
                        }
                    }
                }
            } else {
                reasons.push(format!(
                    "no spend threshold configured for {}; using baseline",
                    currency
                ));
                score += 0.05;
            }

            if spend
                .merchant
                .as_deref()
                .map(|merchant| merchant.to_ascii_lowercase().contains("crypto"))
                .unwrap_or(false)
            {
                level = level.max(RiskLevel::Medium);
                score += 0.2;
                reasons.push("merchant contains crypto keyword".into());
            }
        }

        let mut tag_score = 0.0;
        for tag in &input.tags {
            if let Some(weight) = self.config.tag_weights.get(tag) {
                tag_score += weight;
                reasons.push(format!("tag {tag} contributes {weight:.2} risk weight"));
            }
        }

        if tag_score >= self.config.tag_high_threshold {
            level = RiskLevel::High;
        } else if tag_score >= self.config.tag_medium_threshold {
            level = level.max(RiskLevel::Medium);
        }

        score += tag_score;

        let mut confidence = (self.config.baseline_confidence + score).clamp(0.05, 0.99);
        confidence = match level {
            RiskLevel::Low => confidence.min(0.6),
            RiskLevel::Medium => confidence.clamp(0.55, 0.8),
            RiskLevel::High => confidence.max(0.8),
        };

        RiskVerdict {
            level,
            confidence,
            reasons,
        }
    }
}

fn threshold_normalized(threshold: &SpendThreshold) -> SpendThreshold {
    threshold.normalized()
}

#[derive(Debug, Clone, Default)]
pub struct RiskInput {
    pub tags: Vec<String>,
    pub spend: Option<SpendContext>,
}

#[derive(Debug, Clone)]
pub struct SpendContext {
    pub amount_minor_units: u64,
    pub currency: String,
    pub merchant: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum RiskLevel {
    Low = 0,
    Medium = 1,
    High = 2,
}

impl RiskLevel {
    fn max(self, other: Self) -> Self {
        if (self as u8) >= (other as u8) {
            self
        } else {
            other
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RiskVerdict {
    pub level: RiskLevel,
    pub confidence: f32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RiskConfig;

    #[test]
    fn upgrades_to_high_when_amount_crosses_threshold() {
        let mut config = RiskConfig::default();
        config.spend_thresholds.insert(
            "USD".into(),
            SpendThreshold {
                caution_minor_units: 50_000,
                high_minor_units: 100_000,
            },
        );
        let classifier = RiskClassifier::new(config);

        let input = RiskInput {
            tags: vec![],
            spend: Some(SpendContext {
                amount_minor_units: 120_000,
                currency: "usd".into(),
                merchant: Some("Coffee Club".into()),
            }),
        };

        let verdict = classifier.classify(&input);
        assert_eq!(verdict.level, RiskLevel::High);
        assert!(verdict.confidence >= 0.8);
    }

    #[test]
    fn considers_tag_weights_for_medium_risk() {
        let mut config = RiskConfig::default();
        config.tag_weights.insert("risk:manual_review".into(), 0.35);
        let classifier = RiskClassifier::new(config);

        let verdict = classifier.classify(&RiskInput {
            tags: vec!["risk:manual_review".into()],
            spend: None,
        });

        assert_eq!(verdict.level, RiskLevel::Medium);
        assert!(verdict.confidence >= 0.55);
        assert!(
            verdict
                .reasons
                .iter()
                .any(|reason| reason.contains("risk:manual_review"))
        );
    }
}
