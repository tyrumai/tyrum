import { useState } from "react";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { OnboardingStepper } from "../components/OnboardingStepper.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { Notice } from "../components/Notice.js";

interface ConsentSnapshot {
  selections: {
    shareCalendarSignals: boolean;
    allowPlannerAutonomy: boolean;
    retainAuditTrail: boolean;
  };
  revision: number;
  auditReference: string;
}

export function OnboardingConsent() {
  const { data, error, loading, refetch } = useApi<ConsentSnapshot>(
    () => apiFetch<ConsentSnapshot>("/api/onboarding/consent"),
    [],
  );

  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);
  const [shareCalendarSignals, setShareCalendarSignals] = useState<boolean | null>(null);
  const [allowPlannerAutonomy, setAllowPlannerAutonomy] = useState<boolean | null>(null);
  const [retainAuditTrail, setRetainAuditTrail] = useState<boolean | null>(null);

  const share = shareCalendarSignals ?? data?.selections.shareCalendarSignals ?? false;
  const planner = allowPlannerAutonomy ?? data?.selections.allowPlannerAutonomy ?? false;
  const audit = retainAuditTrail ?? data?.selections.retainAuditTrail ?? false;

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return null;

  const selected = [share, planner, audit].filter(Boolean).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      await apiFetch("/api/onboarding/consent", {
        method: "POST",
        body: JSON.stringify({
          selections: {
            shareCalendarSignals: share,
            allowPlannerAutonomy: planner,
            retainAuditTrail: audit,
          },
        }),
      });
      setNotice({ message: "Consent selections recorded.", tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Failed to save.", tone: "error" });
    }
  }

  return (
    <>
      <PageHeader title="Onboarding Consent" subtitle="Confirm guardrail toggles before first run." />

      <OnboardingStepper activeStep={3} />

      {notice && <Notice message={notice.message} tone={notice.tone} />}

      <Card>
        <div className="kv">
          <strong>Selected</strong><span>{selected} / 3</span>
          <strong>Status</strong><span>{data.revision > 0 ? "Recorded" : "Draft"}</span>
          <strong>Audit reference</strong><span>{data.auditReference}</span>
          <strong>Revision</strong><span>{data.revision}</span>
        </div>
      </Card>

      <form onSubmit={submit}>
        <Card>
          <label>
            <input type="checkbox" checked={share} onChange={(e) => setShareCalendarSignals(e.target.checked)} />
            {" "}Share scheduling signals
          </label>
          <p className="helper">Allow Tyrum to read summary-level calendar signals for proactive planning.</p>

          <label>
            <input type="checkbox" checked={planner} onChange={(e) => setAllowPlannerAutonomy(e.target.checked)} />
            {" "}Approve autopilot guardrails
          </label>
          <p className="helper">Permit actions under your defined spend and policy limits.</p>

          <label>
            <input type="checkbox" checked={audit} onChange={(e) => setRetainAuditTrail(e.target.checked)} />
            {" "}Retain consent audit trail
          </label>
          <p className="helper">Maintain local tamper-evident consent evidence for review/export.</p>

          <div className="actions"><button type="submit">Record consent selections</button></div>
        </Card>
      </form>
    </>
  );
}
