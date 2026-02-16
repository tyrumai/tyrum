/**
 * Risk classifier — port of services/risk_classifier/src/classifier.rs
 * and services/risk_classifier/src/config.rs
 *
 * Pure risk scoring engine using configurable spend thresholds and tag weights.
 */

import type {
  RiskConfig,
  RiskInput,
  RiskVerdict,
  RiskLevel,
  SpendThreshold,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function defaultRiskConfig(): RiskConfig {
  return {
    baseline_confidence: 0.35,
    tag_medium_threshold: 0.3,
    tag_high_threshold: 0.6,
    tag_weights: {},
    spend_thresholds: {},
  };
}

function normalizeThreshold(threshold: SpendThreshold): SpendThreshold {
  const caution = Math.min(
    threshold.caution_minor_units,
    threshold.high_minor_units,
  );
  const high = Math.max(
    threshold.caution_minor_units,
    threshold.high_minor_units,
  );
  return { caution_minor_units: caution, high_minor_units: high };
}

export function normalizeConfig(config: RiskConfig): RiskConfig {
  let tagMedium = config.tag_medium_threshold;
  let tagHigh = config.tag_high_threshold;

  if (tagHigh < tagMedium) {
    const tmp = tagHigh;
    tagHigh = tagMedium;
    tagMedium = tmp;
  }

  const normalizedSpend: Record<string, SpendThreshold> = {};
  for (const [currency, threshold] of Object.entries(config.spend_thresholds)) {
    normalizedSpend[currency] = normalizeThreshold(threshold);
  }

  return {
    baseline_confidence: config.baseline_confidence,
    tag_medium_threshold: tagMedium,
    tag_high_threshold: tagHigh,
    tag_weights: { ...config.tag_weights },
    spend_thresholds: normalizedSpend,
  };
}

// ---------------------------------------------------------------------------
// Risk level ordering
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const aScore = RISK_ORDER[a] ?? 0;
  const bScore = RISK_ORDER[b] ?? 0;
  return aScore >= bScore ? a : b;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export class RiskClassifier {
  private config: RiskConfig;

  constructor(config: RiskConfig) {
    this.config = normalizeConfig(config);
  }

  classify(input: RiskInput): RiskVerdict {
    let level: RiskLevel = "low";
    let score = 0;
    const reasons: string[] = [];

    if (input.spend != null) {
      const spend = input.spend;
      const currency = spend.currency.toUpperCase();
      const threshold = this.config.spend_thresholds[currency];

      if (threshold != null) {
        const normalized = normalizeThreshold(threshold);
        const amount = spend.amount_minor_units;

        if (amount >= normalized.high_minor_units) {
          level = "high";
          score += 0.4;
          reasons.push(
            `amount ${amount} ${currency} exceeds high threshold ${normalized.high_minor_units}`,
          );
        } else if (amount >= normalized.caution_minor_units) {
          level = maxRiskLevel(level, "medium");
          score += 0.25;
          reasons.push(
            `amount ${amount} ${currency} exceeds caution threshold ${normalized.caution_minor_units}`,
          );
        }
      } else {
        reasons.push(
          `no spend threshold configured for ${currency}; using baseline`,
        );
        score += 0.05;
      }

      if (
        spend.merchant != null &&
        spend.merchant.toLowerCase().includes("crypto")
      ) {
        level = maxRiskLevel(level, "medium");
        score += 0.2;
        reasons.push("merchant contains crypto keyword");
      }
    }

    let tagScore = 0;
    for (const tag of input.tags) {
      const weight = this.config.tag_weights[tag];
      if (weight != null) {
        tagScore += weight;
        reasons.push(
          `tag ${tag} contributes ${weight.toFixed(2)} risk weight`,
        );
      }
    }

    if (tagScore >= this.config.tag_high_threshold) {
      level = "high";
    } else if (tagScore >= this.config.tag_medium_threshold) {
      level = maxRiskLevel(level, "medium");
    }

    score += tagScore;

    let confidence = Math.min(
      Math.max(this.config.baseline_confidence + score, 0.05),
      0.99,
    );
    switch (level) {
      case "low":
        confidence = Math.min(confidence, 0.6);
        break;
      case "medium":
        confidence = Math.min(Math.max(confidence, 0.55), 0.8);
        break;
      case "high":
        confidence = Math.max(confidence, 0.8);
        break;
    }

    return { level, confidence, reasons };
  }
}
