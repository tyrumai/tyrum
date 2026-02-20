import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { resetLocalStoreForTesting } from "../../src/modules/web/local-store.js";
import { resetConsentStore } from "../../src/modules/web/consent-store.js";

const PLAN_ID = "3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852";

describe("gateway-hosted web API + UI", () => {
  let app: Hono;

  beforeEach(async () => {
    resetLocalStoreForTesting();
    resetConsentStore();
    app = (await createTestApp()).app;
  });

  it("serves /app dashboard and does not expose /portal redirects", async () => {
    const appRes = await app.request("/app");
    expect(appRes.status).toBe(200);
    const html = await appRes.text();
    expect(html).toContain("Dashboard");

    const portalRes = await app.request("/portal");
    expect(portalRes.status).toBe(404);
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

  it("records consent via /app action route", async () => {
    const formBody = new URLSearchParams();
    formBody.set("shareCalendarSignals", "true");
    formBody.set("allowPlannerAutonomy", "true");
    formBody.set("retainAuditTrail", "true");

    const response = await app.request("/app/actions/onboarding/consent", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/app/onboarding/consent");

    const snapshot = await app.request("/api/onboarding/consent");
    const payload = (await snapshot.json()) as { revision: number };
    expect(payload.revision).toBe(1);
  });

  it("stores PAM profile from settings action form", async () => {
    const body = new URLSearchParams({
      escalation_mode: "act_within_limits",
      limit_minor_units: "2500",
      currency: "USD",
    });

    const response = await app.request("/app/actions/settings/pam", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/app/settings");

    const profiles = await app.request("/api/profiles");
    const payload = (await profiles.json()) as {
      pam: {
        version: string;
        profile: {
          escalation_mode: string;
          auto_approve: {
            limit_minor_units: number;
            currency: string;
          };
        };
      } | null;
    };

    expect(payload.pam?.version).toMatch(/^pam-v/);
    expect(payload.pam?.profile.escalation_mode).toBe("act_within_limits");
    expect(payload.pam?.profile.auto_approve.limit_minor_units).toBe(2500);
    expect(payload.pam?.profile.auto_approve.currency).toBe("USD");
  });

  it("rejects incomplete pronunciation rows in PVP settings form", async () => {
    const body = new URLSearchParams({
      tone: "calm",
      pron_token: "Tyrum",
      pron_pronounce: "",
    });

    const response = await app.request("/app/actions/settings/pvp", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/app/settings");
    expect(location).toContain("tone=error");

    const profiles = await app.request("/api/profiles");
    const payload = (await profiles.json()) as { pvp: unknown };
    expect(payload.pvp).toBeNull();
  });

  it("enforces voice preview prerequisites in settings action route", async () => {
    const first = await app.request("/app/actions/settings/voice-preview", {
      method: "POST",
    });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toContain("tone=error");

    const saveWithoutVoice = await app.request("/app/actions/settings/pvp", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ tone: "calm" }).toString(),
    });
    expect(saveWithoutVoice.status).toBe(302);

    const second = await app.request("/app/actions/settings/voice-preview", {
      method: "POST",
    });
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toContain("tone=error");

    const saveWithVoice = await app.request("/app/actions/settings/pvp", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        tone: "calm",
        voice_id: "nova",
      }).toString(),
    });
    expect(saveWithVoice.status).toBe(302);

    const third = await app.request("/app/actions/settings/voice-preview", {
      method: "POST",
    });
    expect(third.status).toBe(302);
    expect(third.headers.get("location")).toContain("Voice+preview+generated");
  });
});
