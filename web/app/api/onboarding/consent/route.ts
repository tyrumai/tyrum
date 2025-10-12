import { NextRequest, NextResponse } from "next/server";
import {
  type ConsentSelections,
  type CalibrationSnapshot,
  persistConsent,
  snapshotConsent,
} from "./store";

function isConsentSelections(payload: unknown): payload is ConsentSelections {
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

function isCalibrationSnapshot(payload: unknown): payload is CalibrationSnapshot {
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

export async function GET() {
  return NextResponse.json(snapshotConsent(), { status: 200 });
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "Request body must be valid JSON with consent selections.",
      },
      { status: 400 },
    );
  }

  const selections = (payload as { selections?: unknown }).selections;
  const calibrationPayload = (payload as { calibration?: unknown }).calibration;

  if (!isConsentSelections(selections)) {
    return NextResponse.json(
      {
        error: "invalid_selections",
        message:
          "Consent selections must include shareCalendarSignals, allowPlannerAutonomy, and retainAuditTrail boolean toggles.",
      },
      { status: 400 },
    );
  }

  let calibration: CalibrationSnapshot | undefined;
  if (typeof calibrationPayload !== "undefined") {
    if (!isCalibrationSnapshot(calibrationPayload)) {
      return NextResponse.json(
        {
          error: "invalid_calibration",
          message:
            "Calibration payload must include persona, startedAt, completedAt, and durationSeconds fields.",
        },
        { status: 400 },
      );
    }

    calibration = calibrationPayload;
  }

  const record = persistConsent(selections, calibration);

  return NextResponse.json(
    {
      status: "recorded",
      auditReference: record.auditReference,
      revision: record.revision,
      recordedAt: record.recordedAt,
      selections: record.selections,
      calibration: record.calibration,
      stub: record.stub,
    },
    { status: 201 },
  );
}
