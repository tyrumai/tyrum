import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createWebApiRoutes } from "../../src/routes/web-api.js";
import { resetConsentStore } from "../../src/modules/web/consent-store.js";
import { resetLocalStoreForTesting } from "../../src/modules/web/local-store.js";

describe("web-api routes", () => {
  const app = new Hono();
  app.route("/", createWebApiRoutes());

  beforeEach(() => {
    resetConsentStore();
    resetLocalStoreForTesting();
  });

  // --- GET /api/profiles ---

  it("GET /api/profiles returns profiles", async () => {
    const res = await app.request("/api/profiles");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pam: unknown; pvp: unknown };
    expect(body).toHaveProperty("pam");
    expect(body).toHaveProperty("pvp");
  });

  // --- PUT /api/profiles/pam ---

  it("PUT /api/profiles/pam updates PAM profile", async () => {
    const res = await app.request("/api/profiles/pam", {
      method: "PUT",
      body: JSON.stringify({ profile: { tone: "warm" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; profile: Record<string, unknown>; version: string };
    expect(body.status).toBe("updated");
    expect(body.profile).toEqual({ tone: "warm" });
    expect(body.version).toMatch(/^pam-v/);
  });

  it("PUT /api/profiles/pam returns 400 for invalid body", async () => {
    const res = await app.request("/api/profiles/pam", {
      method: "PUT",
      body: JSON.stringify({ wrong: "field" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_payload");
  });

  // --- PUT /api/profiles/pvp ---

  it("PUT /api/profiles/pvp updates PVP profile", async () => {
    const res = await app.request("/api/profiles/pvp", {
      method: "PUT",
      body: JSON.stringify({ profile: { voice: "energetic" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; profile: Record<string, unknown>; version: string };
    expect(body.status).toBe("updated");
    expect(body.profile).toEqual({ voice: "energetic" });
    expect(body.version).toMatch(/^pvp-v/);
  });

  // --- POST /api/profiles/pvp/preview ---

  it("POST /api/profiles/pvp/preview returns preview", async () => {
    const res = await app.request("/api/profiles/pvp/preview", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audio_base64: string; format: string };
    expect(body.audio_base64).toBe("ZmFrZS1hdWRpby1kYXRh");
    expect(body.format).toBe("wav");
  });

  // --- GET /api/account-linking/preferences ---

  it("GET /api/account-linking/preferences returns integrations", async () => {
    const res = await app.request("/api/account-linking/preferences");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      account_id: string;
      integrations: Array<{ slug: string; enabled: boolean }>;
    };
    expect(body.account_id).toBe("single-user-local");
    expect(body.integrations.length).toBeGreaterThanOrEqual(2);
  });

  // --- PUT /api/account-linking/preferences/:slug ---

  it("PUT /api/account-linking/preferences/:slug updates preference", async () => {
    const res = await app.request("/api/account-linking/preferences/calendar-suite", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; integration: { slug: string; enabled: boolean } };
    expect(body.status).toBe("updated");
    expect(body.integration.slug).toBe("calendar-suite");
    expect(body.integration.enabled).toBe(true);
  });

  it("PUT /api/account-linking/preferences/:slug returns 400 for invalid body", async () => {
    const res = await app.request("/api/account-linking/preferences/calendar-suite", {
      method: "PUT",
      body: JSON.stringify({ wrong: "field" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_payload");
  });

  // --- GET /api/account-linking/preferences/:slug ---

  it("GET /api/account-linking/preferences/:slug returns 404 for unknown slug", async () => {
    const res = await app.request("/api/account-linking/preferences/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("GET /api/account-linking/preferences/:slug returns known integration", async () => {
    const res = await app.request("/api/account-linking/preferences/calendar-suite");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { integration: { slug: string } };
    expect(body.integration.slug).toBe("calendar-suite");
  });

  // --- POST /api/account/export ---

  it("POST /api/account/export returns 202", async () => {
    const res = await app.request("/api/account/export", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; task: { type: string } };
    expect(body.status).toBe("enqueued");
    expect(body.task.type).toBe("account_export");
  });

  // --- POST /api/account/delete ---

  it("POST /api/account/delete returns 202", async () => {
    const res = await app.request("/api/account/delete", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; task: { type: string } };
    expect(body.status).toBe("enqueued");
    expect(body.task.type).toBe("account_delete");
  });

  // --- GET /api/onboarding/consent ---

  it("GET /api/onboarding/consent returns consent snapshot", async () => {
    const res = await app.request("/api/onboarding/consent");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      revision: number;
      selections: Record<string, boolean>;
    };
    expect(body.revision).toBe(0);
    expect(body.selections.shareCalendarSignals).toBe(false);
    expect(body.selections.allowPlannerAutonomy).toBe(false);
    expect(body.selections.retainAuditTrail).toBe(false);
  });

  // --- POST /api/onboarding/consent ---

  it("POST /api/onboarding/consent records consent", async () => {
    const res = await app.request("/api/onboarding/consent", {
      method: "POST",
      body: JSON.stringify({
        selections: {
          shareCalendarSignals: true,
          allowPlannerAutonomy: false,
          retainAuditTrail: true,
        },
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: string;
      revision: number;
      selections: Record<string, boolean>;
    };
    expect(body.status).toBe("recorded");
    expect(body.revision).toBe(1);
    expect(body.selections.shareCalendarSignals).toBe(true);
    expect(body.selections.retainAuditTrail).toBe(true);
  });

  it("POST /api/onboarding/consent returns 400 for invalid selections", async () => {
    const res = await app.request("/api/onboarding/consent", {
      method: "POST",
      body: JSON.stringify({
        selections: { shareCalendarSignals: "yes" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_selections");
  });

  it("POST /api/onboarding/consent returns 400 for missing body", async () => {
    const res = await app.request("/api/onboarding/consent", {
      method: "POST",
      body: "not-json{{{",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_payload");
  });
});
