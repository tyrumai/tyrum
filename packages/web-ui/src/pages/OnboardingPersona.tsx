import { useState } from "react";
import { useNavigate } from "react-router";
import { apiFetch } from "../lib/api.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { OnboardingStepper } from "../components/OnboardingStepper.js";
import { Notice } from "../components/Notice.js";

export function OnboardingPersona() {
  const navigate = useNavigate();

  const [tone, setTone] = useState("upbeat");
  const [verbosity, setVerbosity] = useState("balanced");
  const [initiative, setInitiative] = useState("act_within_limits");
  const [quietHours, setQuietHours] = useState("21-07");
  const [spending, setSpending] = useState("50");
  const [voice, setVoice] = useState("warm");

  const [shareCalendarSignals, setShareCalendarSignals] = useState(true);
  const [allowPlannerAutonomy, setAllowPlannerAutonomy] = useState(true);
  const [retainAuditTrail, setRetainAuditTrail] = useState(true);

  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);

    const selections = {
      shareCalendarSignals,
      allowPlannerAutonomy,
      retainAuditTrail,
    };

    const calibration = {
      persona: { tone, verbosity, initiative, quietHours, spending, voice },
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt: new Date().toISOString(),
      durationSeconds: 60,
    };

    try {
      await apiFetch("/api/onboarding/consent", {
        method: "POST",
        body: JSON.stringify({ selections, calibration }),
      });
      navigate("/app/onboarding/consent");
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Failed to save.", tone: "error" });
    }
  }

  return (
    <>
      <PageHeader title="Onboarding Persona" subtitle="Capture persona defaults and consent in one guided submission." />

      <OnboardingStepper activeStep={2} />

      {notice && <Notice message={notice.message} tone={notice.tone} />}

      <form onSubmit={submit}>
        <Card>
          <h2>Persona</h2>
          <p className="muted">Set the default voice and behavior profile used in autonomous runs.</p>

          <div className="settings-grid">
            <div>
              <label htmlFor="persona-tone">Tone</label>
              <select id="persona-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="upbeat">Upbeat</option>
                <option value="neutral">Neutral</option>
                <option value="formal">Formal</option>
              </select>
            </div>
            <div>
              <label htmlFor="persona-verbosity">Verbosity</label>
              <select id="persona-verbosity" value={verbosity} onChange={(e) => setVerbosity(e.target.value)}>
                <option value="terse">Crisp</option>
                <option value="balanced">Balanced</option>
                <option value="thorough">Thorough</option>
              </select>
            </div>
            <div>
              <label htmlFor="persona-initiative">Initiative</label>
              <select id="persona-initiative" value={initiative} onChange={(e) => setInitiative(e.target.value)}>
                <option value="ask_first">Ask every time</option>
                <option value="ask_once_per_vendor">Ask once per vendor</option>
                <option value="act_within_limits">Act within limits</option>
              </select>
            </div>
            <div>
              <label htmlFor="persona-quiet">Quiet hours</label>
              <input id="persona-quiet" value={quietHours} onChange={(e) => setQuietHours(e.target.value)} />
            </div>
            <div>
              <label htmlFor="persona-spending">Spending</label>
              <input id="persona-spending" value={spending} onChange={(e) => setSpending(e.target.value)} />
            </div>
            <div>
              <label htmlFor="persona-voice">Voice sample</label>
              <select id="persona-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                <option value="bright">Bright</option>
                <option value="warm">Warm</option>
                <option value="precise">Precise</option>
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <h2>Consent</h2>
          <p className="muted">Choose which guardrails Tyrum can enforce automatically.</p>
          <label>
            <input type="checkbox" checked={shareCalendarSignals} onChange={(e) => setShareCalendarSignals(e.target.checked)} />
            {" "}Share scheduling signals
          </label>
          <label>
            <input type="checkbox" checked={allowPlannerAutonomy} onChange={(e) => setAllowPlannerAutonomy(e.target.checked)} />
            {" "}Allow planner autonomy
          </label>
          <label>
            <input type="checkbox" checked={retainAuditTrail} onChange={(e) => setRetainAuditTrail(e.target.checked)} />
            {" "}Retain audit trail
          </label>
          <div className="actions"><button type="submit">Record calibration</button></div>
        </Card>
      </form>

      <Card>
        <h2>What happens next</h2>
        <p className="muted">After saving this baseline, continue to the consent checklist.</p>
      </Card>
    </>
  );
}
