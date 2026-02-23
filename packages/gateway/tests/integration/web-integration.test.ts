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

  it("shows updated mode validation copy on invalid onboarding mode submissions", async () => {
    const body = new URLSearchParams({ mode: "bogus" });
    const response = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/app/onboarding/start");
    expect(location).toContain("tone=error");
    expect(location).toContain("Select+Local-Personal+or+Remote-Team+mode+to+continue");
  });

  it("distinguishes draft consent audit metadata from recorded revision", async () => {
    const draft = await app.request("/api/onboarding/consent");
    expect(draft.status).toBe(200);
    const draftBody = (await draft.json()) as {
      revision: number;
      auditReference: string;
      recordedAt: string;
    };

    expect(draftBody.revision).toBe(0);

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
      recordedAt: string;
    };

    expect(postBody.revision).toBe(1);
    expect(postBody.auditReference).not.toBe(draftBody.auditReference);
    expect(postBody.recordedAt).not.toBe(draftBody.recordedAt);
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

  it("preserves persona calibration when updating consent-only selections", async () => {
    const first = new URLSearchParams({
      tone: "formal",
      verbosity: "balanced",
      initiative: "act_within_limits",
      quietHours: "21-07",
      spending: "50",
      voice: "warm",
      shareCalendarSignals: "true",
      allowPlannerAutonomy: "true",
      retainAuditTrail: "true",
    });

    const firstResponse = await app.request("/app/actions/onboarding/consent", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: first.toString(),
    });

    expect(firstResponse.status).toBe(302);

    const afterFirst = await app.request("/api/onboarding/consent");
    const firstPayload = (await afterFirst.json()) as {
      revision: number;
      calibration?: { persona?: Record<string, unknown> };
    };
    expect(firstPayload.revision).toBe(1);
    expect(firstPayload.calibration?.persona).toEqual({
      tone: "formal",
      verbosity: "balanced",
      initiative: "act_within_limits",
      quietHours: "21-07",
      spending: "50",
      voice: "warm",
    });

    const update = new URLSearchParams({
      shareCalendarSignals: "false",
      allowPlannerAutonomy: "true",
      retainAuditTrail: "true",
    });

    const updateResponse = await app.request("/app/actions/onboarding/consent", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: update.toString(),
    });

    expect(updateResponse.status).toBe(302);

    const afterUpdate = await app.request("/api/onboarding/consent");
    const updatePayload = (await afterUpdate.json()) as {
      revision: number;
      calibration?: { persona?: Record<string, unknown> };
    };

    expect(updatePayload.revision).toBe(2);
    expect(updatePayload.calibration?.persona).toEqual({
      tone: "formal",
      verbosity: "balanced",
      initiative: "act_within_limits",
      quietHours: "21-07",
      spending: "50",
      voice: "warm",
    });
  });

  it("uses a consistent onboarding stepper label for step 2", async () => {
    const start = await app.request("/app/onboarding/start");
    expect(start.status).toBe(200);
    const startHtml = await start.text();
    expect(startHtml).toContain("<li>2. Setup</li>");
    expect(startHtml).not.toContain("2. Persona");
    expect(startHtml).not.toContain("2. Hardening");

    const persona = await app.request("/app/onboarding/persona");
    expect(persona.status).toBe(200);
    const personaHtml = await persona.text();
    expect(personaHtml).toContain('<li class="active">2. Setup</li>');

    const remoteTeam = await app.request("/app/onboarding/remote-team");
    expect(remoteTeam.status).toBe(200);
    const remoteHtml = await remoteTeam.text();
    expect(remoteHtml).toContain('<li class="active">2. Setup</li>');
  });

  it("routes remote mode through hardened remote-team onboarding", async () => {
    const body = new URLSearchParams({ mode: "remote" });
    const modeResponse = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(modeResponse.status).toBe(302);
    expect(modeResponse.headers.get("location")).toContain("/app/onboarding/remote-team");

    const checklist = await app.request("/app/onboarding/remote-team");
    expect(checklist.status).toBe(200);
    const html = await checklist.text();
    expect(html).toContain("Remote Team Hardening");
    expect(html).toContain("Trusted proxies allowlist");
    expect(html).toContain("TLS certificate fingerprint");
    expect(html).toContain("Admin Mode step-up");
  });

  it("persists remote-team mode selection before hardening is recorded", async () => {
    const draft = await app.request("/api/onboarding/consent");
    expect(draft.status).toBe(200);
    const draftBody = (await draft.json()) as {
      revision: number;
      auditReference: string;
      recordedAt: string;
    };
    expect(draftBody.revision).toBe(0);

    const body = new URLSearchParams({ mode: "remote" });
    const modeResponse = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(modeResponse.status).toBe(302);

    const snapshot = await app.request("/api/onboarding/consent");
    expect(snapshot.status).toBe(200);
    const payload = (await snapshot.json()) as {
      revision?: number;
      auditReference?: string;
      recordedAt?: string;
      mode?: string;
      remoteHardening?: unknown;
    };

    expect(payload.revision).toBe(0);
    expect(payload.auditReference).toBe(draftBody.auditReference);
    expect(payload.recordedAt).toBe(draftBody.recordedAt);
    expect(payload.mode).toBe("remote-team");
    expect(payload.remoteHardening).toBeUndefined();
  });

  it("records the first consent revision as 1 even after mode selection", async () => {
    const modeResponse = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ mode: "remote" }).toString(),
    });
    expect(modeResponse.status).toBe(302);

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
    const payload = (await post.json()) as { revision?: number };
    expect(payload.revision).toBe(1);
  });

  it("blocks consent checklist until remote-team hardening is recorded", async () => {
    const body = new URLSearchParams({ mode: "remote" });
    const modeResponse = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(modeResponse.status).toBe(302);

    const consent = await app.request("/app/onboarding/consent");
    expect(consent.status).toBe(302);
    const location = consent.headers.get("location") ?? "";
    expect(location).toContain("/app/onboarding/remote-team");
    expect(location).toContain("tone=error");
  });

  it("blocks recording consent until remote-team hardening is recorded", async () => {
    const body = new URLSearchParams({ mode: "remote" });
    const modeResponse = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    expect(modeResponse.status).toBe(302);

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
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/app/onboarding/remote-team");
    expect(location).toContain("tone=error");

    const snapshot = await app.request("/api/onboarding/consent");
    const payload = (await snapshot.json()) as {
      selections?: Record<string, boolean>;
    };
    expect(payload.selections).toEqual({
      shareCalendarSignals: false,
      allowPlannerAutonomy: false,
      retainAuditTrail: false,
    });
  });

  it("does not clear recorded remote-team hardening when remote mode is re-selected", async () => {
    const completed = new URLSearchParams({
      ownerBootstrapConfirmed: "true",
      nonLocalDeviceApproval: "true",
      deviceBoundTokens: "true",
      trustedProxyAllowlist: "true",
      tlsReady: "true",
      adminModeStepUp: "true",
      tlsPinning: "true",
      deploymentProfile: "split-role",
      stateStore: "postgres",
    });

    const hardening = await app.request("/app/actions/onboarding/remote-team", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: completed.toString(),
    });
    expect(hardening.status).toBe(302);

    const modeResponse = await app.request("/app/actions/onboarding/mode", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ mode: "remote" }).toString(),
    });
    expect(modeResponse.status).toBe(302);

    const snapshot = await app.request("/api/onboarding/consent");
    const payload = (await snapshot.json()) as {
      mode?: string;
      remoteHardening?: Record<string, unknown>;
    };

    expect(payload.mode).toBe("remote-team");
    expect(payload.remoteHardening).toEqual({
      ownerBootstrapConfirmed: true,
      nonLocalDeviceApproval: true,
      deviceBoundTokens: true,
      trustedProxyAllowlist: true,
      tlsReady: true,
      adminModeStepUp: true,
      tlsPinning: true,
      deploymentProfile: "split-role",
      stateStore: "postgres",
    });
  });

  it("requires all remote-team hardening acknowledgements before continuing", async () => {
    const incomplete = new URLSearchParams({
      ownerBootstrapConfirmed: "true",
      nonLocalDeviceApproval: "true",
      deviceBoundTokens: "true",
      trustedProxyAllowlist: "true",
      tlsReady: "true",
      deploymentProfile: "split-role",
      stateStore: "postgres",
    });

    const response = await app.request("/app/actions/onboarding/remote-team", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: incomplete.toString(),
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/app/onboarding/remote-team");
    expect(location).toContain("tone=error");
  });

  it("returns a validation redirect when remote-team deployment fields are missing", async () => {
    const missing = new URLSearchParams({
      ownerBootstrapConfirmed: "true",
      nonLocalDeviceApproval: "true",
      deviceBoundTokens: "true",
      trustedProxyAllowlist: "true",
      tlsReady: "true",
      adminModeStepUp: "true",
    });

    const response = await app.request("/app/actions/onboarding/remote-team", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: missing.toString(),
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/app/onboarding/remote-team");
    expect(location).toContain("tone=error");
  });

  it("records remote-team hardening details in onboarding snapshot", async () => {
    const draft = await app.request("/api/onboarding/consent");
    expect(draft.status).toBe(200);
    const draftBody = (await draft.json()) as {
      revision: number;
      auditReference: string;
      recordedAt: string;
    };
    expect(draftBody.revision).toBe(0);

    const completed = new URLSearchParams({
      ownerBootstrapConfirmed: "true",
      nonLocalDeviceApproval: "true",
      deviceBoundTokens: "true",
      trustedProxyAllowlist: "true",
      tlsReady: "true",
      adminModeStepUp: "true",
      tlsPinning: "true",
      deploymentProfile: "split-role",
      stateStore: "postgres",
    });

    const response = await app.request("/app/actions/onboarding/remote-team", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: completed.toString(),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/app/onboarding/consent");

    const snapshot = await app.request("/api/onboarding/consent");
    expect(snapshot.status).toBe(200);
    const payload = (await snapshot.json()) as {
      revision?: number;
      auditReference?: string;
      recordedAt?: string;
      mode?: string;
      remoteHardening?: {
        ownerBootstrapConfirmed: boolean;
        nonLocalDeviceApproval: boolean;
        deviceBoundTokens: boolean;
        trustedProxyAllowlist: boolean;
        tlsReady: boolean;
        adminModeStepUp: boolean;
        tlsPinning: boolean;
        deploymentProfile: string;
        stateStore: string;
      };
    };

    expect(payload.revision).toBe(0);
    expect(payload.auditReference).toBe(draftBody.auditReference);
    expect(payload.recordedAt).toBe(draftBody.recordedAt);
    expect(payload.mode).toBe("remote-team");
    expect(payload.remoteHardening).toEqual({
      ownerBootstrapConfirmed: true,
      nonLocalDeviceApproval: true,
      deviceBoundTokens: true,
      trustedProxyAllowlist: true,
      tlsReady: true,
      adminModeStepUp: true,
      tlsPinning: true,
      deploymentProfile: "split-role",
      stateStore: "postgres",
    });
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
