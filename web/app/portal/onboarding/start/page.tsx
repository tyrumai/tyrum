import React from "react";
import CalibrationFlow from "./calibration-flow";

export default function OnboardingStart() {
  return (
    <main className="portal-onboarding" aria-labelledby="onboarding-heading">
      <header className="portal-onboarding__header">
        <div>
          <p className="portal-onboarding__eyebrow">Portal</p>
          <h1 id="onboarding-heading">Onboarding Start</h1>
        </div>
        <p className="portal-onboarding__lead">
          Calibrate Tyrum to your voice so planning and guardrails match your local single-user workspace.
        </p>
      </header>
      <CalibrationFlow />
      <section className="portal-onboarding__next">
        <h2>What happens next</h2>
        <p>
          Once calibration is recorded we&apos;ll surface watcher defaults so you can review spend,
          privacy, and escalation observers before first use.
        </p>
      </section>
    </main>
  );
}
