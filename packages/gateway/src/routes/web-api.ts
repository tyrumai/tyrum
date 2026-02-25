import { Hono } from "hono";
import {
  buildAuditTaskResponse,
  getPlanTimeline,
  listIntegrations,
  previewVoice,
  readProfiles,
  savePamProfile,
  savePvpProfile,
  setIntegrationPreference,
} from "../modules/web/local-store.js";
import {
  isCalibrationSnapshot,
  isConsentSelections,
  persistConsent,
  snapshotConsent,
} from "../modules/web/consent-store.js";

async function readJsonBody(req: { json(): Promise<unknown> }) {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function createWebApiRoutes(): Hono {
  const api = new Hono();

  api.get("/api/profiles", (c) => c.json(readProfiles(), 200));

  api.put("/api/profiles/pam", async (c) => {
    const body = await readJsonBody(c.req);
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as { profile?: unknown }).profile !== "object" ||
      Array.isArray((body as { profile?: unknown }).profile)
    ) {
      return c.json(
        {
          error: "invalid_payload",
          message: "Body must include a 'profile' object.",
        },
        400,
      );
    }

    const saved = savePamProfile((body as { profile: Record<string, unknown> }).profile);
    return c.json(
      {
        status: "updated",
        profile: saved.profile,
        version: saved.version,
      },
      200,
    );
  });

  api.put("/api/profiles/pvp", async (c) => {
    const body = await readJsonBody(c.req);
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as { profile?: unknown }).profile !== "object" ||
      Array.isArray((body as { profile?: unknown }).profile)
    ) {
      return c.json(
        {
          error: "invalid_payload",
          message: "Body must include a 'profile' object.",
        },
        400,
      );
    }

    const saved = savePvpProfile((body as { profile: Record<string, unknown> }).profile);
    return c.json(
      {
        status: "updated",
        profile: saved.profile,
        version: saved.version,
      },
      200,
    );
  });

  api.post("/api/profiles/pvp/preview", (c) => c.json(previewVoice(), 200));

  api.get("/api/account-linking/preferences", (c) => c.json(listIntegrations(), 200));

  api.put("/api/account-linking/preferences/:slug", async (c) => {
    const slug = c.req.param("slug")?.trim();
    if (!slug) {
      return c.json(
        {
          error: "invalid_slug",
          message: "Integration slug must be provided.",
        },
        400,
      );
    }

    const body = await readJsonBody(c.req);
    if (!body || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
      return c.json(
        {
          error: "invalid_payload",
          message: "Body must include an 'enabled' boolean field.",
        },
        400,
      );
    }

    const integration = setIntegrationPreference(
      slug,
      Boolean((body as { enabled: boolean }).enabled),
    );
    if (!integration) {
      return c.json(
        {
          error: "not_found",
          message: `No integration preference registered for slug '${slug}'.`,
        },
        404,
      );
    }

    return c.json(
      {
        status: "updated",
        integration,
      },
      200,
    );
  });

  api.get("/api/account-linking/preferences/:slug", (c) => {
    const slug = c.req.param("slug")?.trim();
    if (!slug) {
      return c.json(
        {
          error: "invalid_slug",
          message: "Integration slug must be provided.",
        },
        400,
      );
    }

    const integration = listIntegrations().integrations.find((entry) => entry.slug === slug);
    if (!integration) {
      return c.json(
        {
          error: "not_found",
          message: `No integration preference registered for slug '${slug}'.`,
        },
        404,
      );
    }

    return c.json({ integration }, 200);
  });

  api.post("/api/account/export", (c) => c.json(buildAuditTaskResponse("export"), 202));
  api.post("/api/account/delete", (c) => c.json(buildAuditTaskResponse("delete"), 202));

  api.get("/api/audit/plan/:planId", (c) => {
    const planId = c.req.param("planId")?.trim();

    if (!planId) {
      return c.json(
        {
          error: "invalid_plan",
          message: "Plan identifier must be provided in the route.",
        },
        400,
      );
    }

    const timeline = getPlanTimeline(planId);
    if (!timeline) {
      return c.json(
        {
          error: "plan_not_found",
          message: "Plan audit timeline not found.",
        },
        404,
      );
    }

    return c.json(timeline, 200);
  });

  api.get("/api/onboarding/consent", (c) => c.json(snapshotConsent(), 200));

  api.post("/api/onboarding/consent", async (c) => {
    const payload = await readJsonBody(c.req);
    if (!payload || typeof payload !== "object") {
      return c.json(
        {
          error: "invalid_payload",
          message: "Request body must be valid JSON with consent selections.",
        },
        400,
      );
    }

    const selections = (payload as { selections?: unknown }).selections;
    const calibrationPayload = (payload as { calibration?: unknown }).calibration;

    if (!isConsentSelections(selections)) {
      return c.json(
        {
          error: "invalid_selections",
          message:
            "Consent selections must include shareCalendarSignals, allowPlannerAutonomy, and retainAuditTrail boolean toggles.",
        },
        400,
      );
    }

    if (typeof calibrationPayload !== "undefined" && !isCalibrationSnapshot(calibrationPayload)) {
      return c.json(
        {
          error: "invalid_calibration",
          message:
            "Calibration payload must include persona, startedAt, completedAt, and durationSeconds fields.",
        },
        400,
      );
    }

    const record = persistConsent(selections, calibrationPayload);
    return c.json(
      {
        status: "recorded",
        auditReference: record.auditReference,
        revision: record.revision,
        recordedAt: record.recordedAt,
        selections: record.selections,
        calibration: record.calibration,
        stub: record.stub,
      },
      201,
    );
  });

  return api;
}
