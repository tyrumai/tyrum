/**
 * Risk classifier tests — port of services/risk_classifier/src/classifier.rs tests
 */

import { describe, expect, it } from "vitest";
import {
  RiskClassifier,
  defaultRiskConfig,
} from "../../src/modules/risk/classifier.js";

describe("RiskClassifier", () => {
  it("defaults to low risk", () => {
    const classifier = new RiskClassifier(defaultRiskConfig());
    const verdict = classifier.classify({ tags: [] });
    expect(verdict.level).toBe("low");
  });

  it("upgrades to high when amount crosses threshold", () => {
    const config = {
      ...defaultRiskConfig(),
      spend_thresholds: {
        USD: {
          caution_minor_units: 50_000,
          high_minor_units: 100_000,
        },
      },
    };
    const classifier = new RiskClassifier(config);

    const verdict = classifier.classify({
      tags: [],
      spend: {
        amount_minor_units: 120_000,
        currency: "usd",
        merchant: "Coffee Club",
      },
    });

    expect(verdict.level).toBe("high");
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("considers tag weights for medium risk", () => {
    const config = {
      ...defaultRiskConfig(),
      tag_weights: { "risk:manual_review": 0.35 },
    };
    const classifier = new RiskClassifier(config);

    const verdict = classifier.classify({
      tags: ["risk:manual_review"],
    });

    expect(verdict.level).toBe("medium");
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.55);
    expect(
      verdict.reasons.some((r) => r.includes("risk:manual_review")),
    ).toBe(true);
  });
});
