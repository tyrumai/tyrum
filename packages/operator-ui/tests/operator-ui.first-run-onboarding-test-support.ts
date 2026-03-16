import { registerFirstRunOnboardingFlowTests } from "./operator-ui.first-run-onboarding-flow-test-support.js";
import { registerFirstRunOnboardingProviderPickerTests } from "./operator-ui.first-run-onboarding-provider-picker-test-support.js";
import { registerFirstRunOnboardingStateTests } from "./operator-ui.first-run-onboarding-state-test-support.js";

export function registerFirstRunOnboardingTests(): void {
  registerFirstRunOnboardingStateTests();
  registerFirstRunOnboardingFlowTests();
  registerFirstRunOnboardingProviderPickerTests();
}
