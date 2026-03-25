import { describe, expect, it } from "vitest";
import {
  getRelevantOnboardingIssues,
  resolveFirstRunOnboardingStep,
  resolveVisibleFirstRunOnboardingStep,
  summarizeOnboardingIssues,
  type FirstRunOnboardingIssue,
} from "../src/components/pages/first-run-onboarding.shared.js";

const catalogIssue = {
  code: "model_catalog_refresh_failed",
  severity: "warning",
  message: "Model catalog refresh failed: models.dev fetch failed (502): upstream unavailable.",
  target: { kind: "deployment", id: null },
} satisfies FirstRunOnboardingIssue;

describe("first-run onboarding shared config health handling", () => {
  it("treats model catalog refresh failures as relevant onboarding issues", () => {
    expect(getRelevantOnboardingIssues([catalogIssue])).toEqual([catalogIssue]);
    expect(summarizeOnboardingIssues([catalogIssue])).toEqual([
      { key: "model-catalog", label: "Model catalog", variant: "warning" },
    ]);
  });

  it("routes catalog refresh failures to the provider step", () => {
    expect(
      resolveFirstRunOnboardingStep({
        issues: [catalogIssue],
        activeProviderCount: 1,
        availableModelCount: 1,
        presetCount: 1,
      }),
    ).toBe("provider");
  });

  it("keeps catalog refresh failures visible once intro gating is satisfied", () => {
    expect(
      resolveVisibleFirstRunOnboardingStep({
        issues: [catalogIssue],
        activeProviderCount: 1,
        availableModelCount: 1,
        presetCount: 1,
        canMutate: true,
        paletteStepComplete: true,
        adminStepComplete: true,
      }),
    ).toBe("provider");
  });
});
