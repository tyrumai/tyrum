interface OnboardingStepperProps {
  activeStep: number;
}

const STEPS = ["1. Mode", "2. Persona", "3. Consent"];

export function OnboardingStepper({ activeStep }: OnboardingStepperProps) {
  return (
    <ol className="onboarding-stepper">
      {STEPS.map((label, index) => (
        <li key={label} className={index + 1 === activeStep ? "active" : ""}>
          {label}
        </li>
      ))}
    </ol>
  );
}
