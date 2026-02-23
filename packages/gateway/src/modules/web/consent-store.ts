export type ConsentToggleKey =
  | "shareCalendarSignals"
  | "allowPlannerAutonomy"
  | "retainAuditTrail";

export type ConsentSelections = Record<ConsentToggleKey, boolean>;

export type OperatingMode = "local-personal" | "remote-team";

export type RemoteTeamHardeningSnapshot = {
  ownerBootstrapConfirmed: boolean;
  nonLocalDeviceApproval: boolean;
  deviceBoundTokens: boolean;
  trustedProxyAllowlist: boolean;
  tlsReady: boolean;
  adminModeStepUp: boolean;
  tlsPinning: boolean;
  deploymentProfile: "single-host" | "split-role";
  stateStore: "sqlite" | "postgres";
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

export type ConsentRecord = {
  id: string;
  revision: number;
  auditReference: string;
  recordedAt: string;
  mode: OperatingMode;
  remoteHardening?: RemoteTeamHardeningSnapshot;
  selections: ConsentSelections;
  calibration?: CalibrationSnapshot;
  stub: {
    persistence: "memory";
    note: string;
  };
};

const CONSENT_RECORD_ID = "onboarding-consent-stub";
const BASE_AUDIT_REFERENCE = "CONSENT-STUB-0001";
const DRAFT_AUDIT_REFERENCE = "CONSENT-STUB-DRAFT";
const BASE_TIMESTAMP = Date.parse("2025-01-20T09:00:00.000Z");

let latestRecord: ConsentRecord | undefined;

function computeRecordedAt(revision: number) {
  if (revision <= 0) {
    return new Date(BASE_TIMESTAMP - 60_000).toISOString();
  }
  const offsetMilliseconds = (revision - 1) * 60_000;
  return new Date(BASE_TIMESTAMP + offsetMilliseconds).toISOString();
}

function buildAuditReference(revision: number) {
  if (revision === 1) {
    return BASE_AUDIT_REFERENCE;
  }

  return `${BASE_AUDIT_REFERENCE}-R${revision.toString().padStart(2, "0")}`;
}

function buildRecord(
  revision: number,
  selections: ConsentSelections,
  calibration: CalibrationSnapshot | undefined,
  mode: OperatingMode,
  remoteHardening: RemoteTeamHardeningSnapshot | undefined,
): ConsentRecord {
  return {
    id: CONSENT_RECORD_ID,
    revision,
    auditReference: revision === 0 ? DRAFT_AUDIT_REFERENCE : buildAuditReference(revision),
    recordedAt: computeRecordedAt(revision),
    mode,
    remoteHardening,
    selections,
    calibration,
    stub: {
      persistence: "memory",
      note: "Replace with onboarding consent service; stub keeps the most recent selections and onboarding mode in memory only.",
    },
  };
}

export function snapshotConsent() {
  if (latestRecord) {
    return structuredClone(latestRecord);
  }

  return buildRecord(
    0,
    {
      shareCalendarSignals: false,
      allowPlannerAutonomy: false,
      retainAuditTrail: false,
    },
    undefined,
    "local-personal",
    undefined,
  );
}

export function persistConsent(
  selections: ConsentSelections,
  calibration?: CalibrationSnapshot,
): ConsentRecord {
  const previous = latestRecord ?? snapshotConsent();
  const revision = previous.revision + 1;

  latestRecord = buildRecord(
    revision,
    selections,
    calibration,
    previous.mode,
    previous.remoteHardening,
  );

  return structuredClone(latestRecord);
}

export function persistOperatingMode(
  mode: OperatingMode,
  remoteHardening?: RemoteTeamHardeningSnapshot,
): ConsentRecord {
  const previous = latestRecord ?? snapshotConsent();
  const nextRemoteHardening =
    mode === "remote-team" ? (remoteHardening ?? previous.remoteHardening) : undefined;

  // Keep consent revision/audit metadata stable; mode/hardening changes are not consent changes.
  latestRecord = buildRecord(
    previous.revision,
    previous.selections,
    previous.calibration,
    mode,
    nextRemoteHardening,
  );

  return structuredClone(latestRecord);
}

export function resetConsentStore() {
  latestRecord = undefined;
}

export function isConsentSelections(payload: unknown): payload is ConsentSelections {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;

  return (
    typeof record.shareCalendarSignals === "boolean" &&
    typeof record.allowPlannerAutonomy === "boolean" &&
    typeof record.retainAuditTrail === "boolean"
  );
}

function isCalibrationPersona(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const allowedKeys = new Set([
    "tone",
    "verbosity",
    "initiative",
    "quietHours",
    "spending",
    "voice",
  ]);
  const record = value as Record<string, unknown>;

  return Object.keys(record).every(
    (key) => allowedKeys.has(key) && (record[key] === undefined || typeof record[key] === "string"),
  );
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isCalibrationSnapshot(payload: unknown): payload is CalibrationSnapshot {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;

  if (!isCalibrationPersona(record.persona)) {
    return false;
  }

  if (!isIsoDate(record.startedAt) || !isIsoDate(record.completedAt)) {
    return false;
  }

  if (
    typeof record.durationSeconds !== "number" ||
    !Number.isFinite(record.durationSeconds) ||
    record.durationSeconds < 0
  ) {
    return false;
  }

  return true;
}
