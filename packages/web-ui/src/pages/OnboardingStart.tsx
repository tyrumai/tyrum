import { useNavigate } from "react-router";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { OnboardingStepper } from "../components/OnboardingStepper.js";

export function OnboardingStart() {
  const navigate = useNavigate();

  function selectMode(mode: "embedded" | "remote") {
    try {
      const hasDesktopHost = Boolean(window.parent && window.parent !== window);
      if (hasDesktopHost) {
        window.parent.postMessage({ type: "tyrum:onboarding-mode-selected", mode }, "*");
      }
    } catch {
      // ignore cross-origin errors
    }

    if (mode === "embedded") {
      navigate("/app/onboarding/persona");
    } else {
      navigate("/app");
    }
  }

  return (
    <>
      <PageHeader title="Onboarding Start" subtitle="Select how this desktop app should connect before continuing setup." />

      <OnboardingStepper activeStep={1} />

      <Card>
        <h2>Connection Mode</h2>
        <p className="muted">Embedded runs a local gateway automatically. Remote connects this desktop app to an external gateway.</p>
        <div className="actions">
          <button type="button" onClick={() => selectMode("embedded")}>Use Embedded Mode</button>
          <button type="button" className="secondary" onClick={() => selectMode("remote")}>Use Remote Mode</button>
        </div>
      </Card>

      <Card>
        <h2>What happens next</h2>
        <p className="muted">Choose Embedded to continue persona + consent onboarding. Choose Remote to stop onboarding and configure a remote connection in Tyrum Desktop.</p>
      </Card>
    </>
  );
}
