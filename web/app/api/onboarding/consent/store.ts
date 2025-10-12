export type ConsentToggleKey =
  | "shareCalendarSignals"
  | "allowPlannerAutonomy"
  | "retainAuditTrail";

export type ConsentSelections = Record<ConsentToggleKey, boolean>;

export type ConsentRecord = {
  id: string;
  revision: number;
  auditReference: string;
  recordedAt: string;
  selections: ConsentSelections;
  calibration?: CalibrationSnapshot;
  stub: {
    persistence: "memory";
    note: string;
  };
};

export type CalibrationPersona = {
  tone?: string;
  verbosity?: string;
  initiative?: string;
  quietHours?: string;
  spending?: string;
  voice?: string;
};

export type CalibrationSnapshot = {
  persona: CalibrationPersona;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
};

const CONSENT_RECORD_ID = "onboarding-consent-stub";
const BASE_AUDIT_REFERENCE = "CONSENT-STUB-0001";
const BASE_TIMESTAMP = Date.parse("2025-01-20T09:00:00.000Z");

let latestRecord: ConsentRecord | undefined;

function computeRecordedAt(revision: number) {
  const offsetMilliseconds = (revision - 1) * 60_000;
  return new Date(BASE_TIMESTAMP + offsetMilliseconds).toISOString();
}

function buildAuditReference(revision: number) {
  if (revision === 1) {
    return BASE_AUDIT_REFERENCE;
  }

  return `${BASE_AUDIT_REFERENCE}-R${revision.toString().padStart(2, "0")}`;
}

export function snapshotConsent() {
  if (latestRecord) {
    return structuredClone(latestRecord);
  }

  return {
    id: CONSENT_RECORD_ID,
    revision: 0,
    auditReference: BASE_AUDIT_REFERENCE,
    recordedAt: new Date(BASE_TIMESTAMP).toISOString(),
    selections: {
      shareCalendarSignals: false,
      allowPlannerAutonomy: false,
      retainAuditTrail: false,
    },
    calibration: undefined,
    stub: {
      persistence: "memory" as const,
      note: "Replace with onboarding consent service; stub keeps the most recent selections in memory only.",
    },
  } satisfies ConsentRecord;
}

export function persistConsent(
  selections: ConsentSelections,
  calibration?: CalibrationSnapshot,
): ConsentRecord {
  const previousRevision = latestRecord?.revision ?? 0;
  const revision = previousRevision + 1;

  latestRecord = {
    id: CONSENT_RECORD_ID,
    revision,
    auditReference: buildAuditReference(revision),
    recordedAt: computeRecordedAt(revision),
    selections,
    calibration,
    stub: {
      persistence: "memory",
      note: "Replace with onboarding consent service; stub keeps the most recent selections in memory only.",
    },
  };

  return structuredClone(latestRecord);
}

export function resetConsentStore() {
  latestRecord = undefined;
}
