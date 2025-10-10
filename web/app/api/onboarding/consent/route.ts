import { NextRequest, NextResponse } from "next/server";
import {
  type ConsentSelections,
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

  const record = persistConsent(selections);

  return NextResponse.json(
    {
      status: "recorded",
      auditReference: record.auditReference,
      revision: record.revision,
      recordedAt: record.recordedAt,
      selections: record.selections,
      stub: record.stub,
    },
    { status: 201 },
  );
}
