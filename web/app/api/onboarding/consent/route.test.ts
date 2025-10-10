import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { resetConsentStore } from "./store";

const ORIGIN = "https://portal.local";

function createRequest(body: unknown) {
  return new NextRequest(`${ORIGIN}/api/onboarding/consent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("onboarding consent route", () => {
  beforeEach(() => {
    resetConsentStore();
  });

  it("returns a deterministic snapshot when no consent has been recorded", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      revision: number;
      stub: { persistence: string };
    };

    expect(payload.revision).toBe(0);
    expect(payload.stub).toMatchObject({
      persistence: "memory",
    });
  });

  it("persists selections and surfaces the audit reference", async () => {
    const request = createRequest({
      selections: {
        shareCalendarSignals: true,
        allowPlannerAutonomy: false,
        retainAuditTrail: true,
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const payload = (await response.json()) as {
      revision: number;
      auditReference: string;
      selections: Record<string, boolean>;
    };

    expect(payload.revision).toBe(1);
    expect(payload.auditReference).toBe("CONSENT-STUB-0001");
    expect(payload.selections).toEqual({
      shareCalendarSignals: true,
      allowPlannerAutonomy: false,
      retainAuditTrail: true,
    });

    const followUp = await GET();
    const followUpPayload = (await followUp.json()) as { revision: number };
    expect(followUpPayload.revision).toBe(1);
  });

  it("increments the revision deterministically across submissions", async () => {
    const first = await POST(
      createRequest({
        selections: {
          shareCalendarSignals: false,
          allowPlannerAutonomy: true,
          retainAuditTrail: true,
        },
      }),
    );
    const firstPayload = (await first.json()) as { revision: number };
    expect(firstPayload.revision).toBe(1);

    const second = await POST(
      createRequest({
        selections: {
          shareCalendarSignals: true,
          allowPlannerAutonomy: true,
          retainAuditTrail: true,
        },
      }),
    );

    const secondPayload = (await second.json()) as {
      revision: number;
      auditReference: string;
    };

    expect(secondPayload.revision).toBe(2);
    expect(secondPayload.auditReference).toBe("CONSENT-STUB-0001-R02");
  });

  it("rejects invalid payloads", async () => {
    const request = createRequest({ selections: { foo: "bar" } });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("invalid_selections");
  });
});
