import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { resetLocalStoreForTesting } from "../../src/modules/web/local-store.js";
import { resetConsentStore } from "../../src/modules/web/consent-store.js";

const PLAN_ID = "3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852";

describe("gateway-hosted web API", () => {
  let app: Hono;

  beforeEach(async () => {
    resetLocalStoreForTesting();
    resetConsentStore();
    app = (await createTestApp()).app;
  });

  it("supports profiles API read/write", async () => {
    const initial = await app.request("/api/profiles");
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as {
      pam: unknown;
      pvp: unknown;
    };
    expect(initialBody.pam).toBeNull();
    expect(initialBody.pvp).toBeNull();

    const update = await app.request("/api/profiles/pam", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: {
          timezone: "America/New_York",
          workStart: "09:00",
        },
      }),
    });

    expect(update.status).toBe(200);
    const updateBody = (await update.json()) as {
      status: string;
      version: string;
      profile: Record<string, unknown>;
    };
    expect(updateBody.status).toBe("updated");
    expect(updateBody.version).toMatch(/^pam-v/);
    expect(updateBody.profile.timezone).toBe("America/New_York");
  });

  it("returns deterministic timeline payload for known plan", async () => {
    const response = await app.request(`/api/audit/plan/${PLAN_ID}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      plan_id: string;
      events: unknown[];
    };

    expect(body.plan_id).toBe(PLAN_ID);
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown timeline plan", async () => {
    const response = await app.request("/api/audit/plan/unknown");
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("plan_not_found");
  });

  it("persists onboarding consent via API", async () => {
    const post = await app.request("/api/onboarding/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selections: {
          shareCalendarSignals: true,
          allowPlannerAutonomy: false,
          retainAuditTrail: true,
        },
      }),
    });

    expect(post.status).toBe(201);
    const postBody = (await post.json()) as {
      revision: number;
      auditReference: string;
      selections: Record<string, boolean>;
    };

    expect(postBody.revision).toBe(1);
    expect(postBody.auditReference).toBe("CONSENT-STUB-0001");
    expect(postBody.selections).toEqual({
      shareCalendarSignals: true,
      allowPlannerAutonomy: false,
      retainAuditTrail: true,
    });

    const snapshot = await app.request("/api/onboarding/consent");
    expect(snapshot.status).toBe(200);
    const snapshotBody = (await snapshot.json()) as { revision: number };
    expect(snapshotBody.revision).toBe(1);
  });
});
