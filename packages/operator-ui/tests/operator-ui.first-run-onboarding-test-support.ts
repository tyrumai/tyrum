import { registerFirstRunOnboardingAgentConfigTests } from "./operator-ui.first-run-onboarding-agent-config-test-support.js";
import { registerFirstRunOnboardingFlowTests } from "./operator-ui.first-run-onboarding-flow-test-support.js";
import { registerFirstRunOnboardingModelPickerTests } from "./operator-ui.first-run-onboarding-model-picker-test-support.js";
import { registerFirstRunOnboardingProviderPickerTests } from "./operator-ui.first-run-onboarding-provider-picker-test-support.js";
import { registerFirstRunOnboardingStateTests } from "./operator-ui.first-run-onboarding-state-test-support.js";

export function registerFirstRunOnboardingTests(): void {
  registerFirstRunOnboardingStateTests();
  registerFirstRunOnboardingFlowTests();
  registerFirstRunOnboardingAgentConfigTests();
  registerFirstRunOnboardingModelPickerTests();
  registerFirstRunOnboardingProviderPickerTests();
}
