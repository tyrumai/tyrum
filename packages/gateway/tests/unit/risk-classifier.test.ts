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

  it("caution-level spend triggers medium risk", () => {
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
        amount_minor_units: 75_000,
        currency: "usd",
      },
    });

    expect(verdict.level).toBe("medium");
    expect(
      verdict.reasons.some((r) => r.includes("caution threshold")),
    ).toBe(true);
  });

  it("spend with no threshold for currency uses baseline", () => {
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
        amount_minor_units: 500,
        currency: "eur",
      },
    });

    expect(verdict.level).toBe("low");
    expect(
      verdict.reasons.some((r) => r.includes("no spend threshold")),
    ).toBe(true);
  });

  it("merchant with crypto keyword bumps to medium", () => {
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
        amount_minor_units: 1_000,
        currency: "usd",
        merchant: "CryptoExchange Inc",
      },
    });

    expect(verdict.level).toBe("medium");
    expect(
      verdict.reasons.some((r) => r.includes("crypto keyword")),
    ).toBe(true);
  });

  it("normal merchant does not trigger crypto flag", () => {
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
        amount_minor_units: 1_000,
        currency: "usd",
        merchant: "Coffee Shop",
      },
    });

    expect(verdict.level).toBe("low");
    expect(
      verdict.reasons.every((r) => !r.includes("crypto keyword")),
    ).toBe(true);
  });

  it("tag weights pushing above high threshold", () => {
    const config = {
      ...defaultRiskConfig(),
      tag_weights: {
        "risk:danger": 0.4,
        "risk:external": 0.3,
      },
    };
    const classifier = new RiskClassifier(config);

    const verdict = classifier.classify({
      tags: ["risk:danger", "risk:external"],
    });

    expect(verdict.level).toBe("high");
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("unknown tag contributes nothing", () => {
    const config = {
      ...defaultRiskConfig(),
      tag_weights: { known: 0.1 },
    };
    const classifier = new RiskClassifier(config);

    const verdict = classifier.classify({
      tags: ["unknown-tag"],
    });

    expect(verdict.level).toBe("low");
    expect(verdict.reasons).toHaveLength(0);
  });

  it("inverted threshold normalization swaps values", () => {
    const config = {
      ...defaultRiskConfig(),
      tag_high_threshold: 0.2,
      tag_medium_threshold: 0.8,
    };

    // After normalization: medium=0.2, high=0.8
    // A tag score of 0.3 should be medium (above 0.2, below 0.8)
    const configWithTag = {
      ...config,
      tag_weights: { t: 0.3 },
    };
    const c2 = new RiskClassifier(configWithTag);
    const verdict = c2.classify({ tags: ["t"] });
    expect(verdict.level).toBe("medium");
  });

  it("spend without merchant field", () => {
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
      },
    });

    expect(verdict.level).toBe("high");
    expect(
      verdict.reasons.every((r) => !r.includes("crypto keyword")),
    ).toBe(true);
  });

  it("medium confidence is clamped between 0.55 and 0.8", () => {
    const config = {
      ...defaultRiskConfig(),
      baseline_confidence: 0.01,
      tag_weights: { t: 0.31 },
    };
    const classifier = new RiskClassifier(config);

    const verdict = classifier.classify({ tags: ["t"] });
    expect(verdict.level).toBe("medium");
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.55);
    expect(verdict.confidence).toBeLessThanOrEqual(0.8);
  });

  it("spend with inverted caution/high thresholds gets normalized", () => {
    const config = {
      ...defaultRiskConfig(),
      spend_thresholds: {
        USD: {
          caution_minor_units: 100_000,
          high_minor_units: 50_000,
        },
      },
    };
    const classifier = new RiskClassifier(config);

    // After normalization: caution=50000, high=100000
    // 75000 should be medium (between 50000 and 100000)
    const verdict = classifier.classify({
      tags: [],
      spend: {
        amount_minor_units: 75_000,
        currency: "usd",
      },
    });

    expect(verdict.level).toBe("medium");
  });
});
