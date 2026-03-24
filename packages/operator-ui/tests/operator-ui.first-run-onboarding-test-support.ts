import { registerFirstRunOnboardingAgentConfigTests } from "./operator-ui.first-run-onboarding-agent-config-test-support.js";
import { registerFirstRunOnboardingFlowTests } from "./operator-ui.first-run-onboarding-flow-test-support.js";
import { registerFirstRunOnboardingInteractionTests } from "./operator-ui.first-run-onboarding-interaction-test-support.js";
import { registerFirstRunOnboardingModelPickerTests } from "./operator-ui.first-run-onboarding-model-picker-test-support.js";
import { registerFirstRunOnboardingPolicyWarningTests } from "./operator-ui.first-run-onboarding-policy-warning-test-support.js";
import { registerFirstRunOnboardingProviderPickerTests } from "./operator-ui.first-run-onboarding-provider-picker-test-support.js";
import { registerFirstRunOnboardingStateTests } from "./operator-ui.first-run-onboarding-state-test-support.js";

export function registerFirstRunOnboardingTests(): void {
  registerFirstRunOnboardingStateTests();
  registerFirstRunOnboardingFlowTests();
  registerFirstRunOnboardingAgentConfigTests();
  registerFirstRunOnboardingInteractionTests();
  registerFirstRunOnboardingPolicyWarningTests();
  registerFirstRunOnboardingModelPickerTests();
  registerFirstRunOnboardingProviderPickerTests();
}
