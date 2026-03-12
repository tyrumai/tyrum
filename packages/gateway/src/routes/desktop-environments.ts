import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  DesktopEnvironmentCreateRequest,
  DesktopEnvironmentDeleteResponse,
  DesktopEnvironmentGetResponse,
  DesktopEnvironmentHostListResponse,
  DesktopEnvironmentListResponse,
  DesktopEnvironmentLogsResponse,
  DesktopEnvironmentMutateResponse,
  DesktopEnvironmentUpdateRequest,
} from "@tyrum/schemas";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../modules/desktop-environments/dal.js";
import type { DesktopEnvironmentLifecycle } from "../modules/desktop-environments/lifecycle-service.js";
import { requireAuthClaims, requireTenantId } from "../modules/auth/claims.js";

const DEFAULT_DESKTOP_ENVIRONMENT_IMAGE = "tyrum-desktop-sandbox:latest";

function requireAdmin(c: { get: (key: string) => unknown }): void {
  const claims = requireAuthClaims(c);
  if (claims.role !== "admin") {
    throw new HTTPException(403, { message: "admin token required" });
  }
}

export function createDesktopEnvironmentRoutes(deps: {
  hostDal: DesktopEnvironmentHostDal;
  environmentDal: DesktopEnvironmentDal;
  lifecycleService: DesktopEnvironmentLifecycle;
}): Hono {
  const app = new Hono();

  app.get("/desktop-environment-hosts", async (c) => {
    requireAdmin(c);
    const hosts = await deps.hostDal.list();
    return c.json(DesktopEnvironmentHostListResponse.parse({ status: "ok", hosts }));
  });

  app.get("/desktop-environments", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const environments = await deps.environmentDal.list(tenantId);
    return c.json(DesktopEnvironmentListResponse.parse({ status: "ok", environments }));
  });

  app.post("/desktop-environments", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const body = await c.req.json();
    const parsed = DesktopEnvironmentCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    const host = await deps.hostDal.get(parsed.data.host_id);
    if (!host) {
      return c.json({ error: "invalid_request", message: "unknown host_id" }, 400);
    }
    const environment = await deps.environmentDal.create({
      tenantId,
      hostId: parsed.data.host_id,
      label: parsed.data.label,
      imageRef: parsed.data.image_ref ?? DEFAULT_DESKTOP_ENVIRONMENT_IMAGE,
      desiredRunning: parsed.data.desired_running ?? false,
    });
    return c.json(DesktopEnvironmentMutateResponse.parse({ status: "ok", environment }), 201);
  });

  app.get("/desktop-environments/:environmentId", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const environment = await deps.environmentDal.get({
      tenantId,
      environmentId: c.req.param("environmentId"),
    });
    if (!environment) {
      return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
    }
    return c.json(DesktopEnvironmentGetResponse.parse({ status: "ok", environment }));
  });

  app.patch("/desktop-environments/:environmentId", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const body = await c.req.json();
    const parsed = DesktopEnvironmentUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    const environment = await deps.environmentDal.update({
      tenantId,
      environmentId: c.req.param("environmentId"),
      label: parsed.data.label,
      imageRef: parsed.data.image_ref,
      desiredRunning: parsed.data.desired_running,
    });
    if (!environment) {
      return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
    }
    return c.json(DesktopEnvironmentMutateResponse.parse({ status: "ok", environment }));
  });

  app.delete("/desktop-environments/:environmentId", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const deleted = await deps.lifecycleService.deleteEnvironment({
      tenantId,
      environmentId: c.req.param("environmentId"),
    });
    return c.json(DesktopEnvironmentDeleteResponse.parse({ status: "ok", deleted }));
  });

  for (const action of ["start", "stop", "reset"] as const) {
    app.post(`/desktop-environments/:environmentId/${action}`, async (c) => {
      requireAdmin(c);
      const tenantId = requireTenantId(c);
      const environmentId = c.req.param("environmentId");
      const environment =
        action === "start"
          ? await deps.environmentDal.start({ tenantId, environmentId })
          : action === "stop"
            ? await deps.environmentDal.stop({ tenantId, environmentId })
            : await deps.environmentDal.reset({ tenantId, environmentId });
      if (!environment) {
        return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
      }
      return c.json(DesktopEnvironmentMutateResponse.parse({ status: "ok", environment }));
    });
  }

  app.get("/desktop-environments/:environmentId/logs", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const environmentId = c.req.param("environmentId");
    const environment = await deps.environmentDal.get({ tenantId, environmentId });
    if (!environment) {
      return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
    }
    const logs = await deps.environmentDal.getLogs({ tenantId, environmentId });
    return c.json(
      DesktopEnvironmentLogsResponse.parse({
        status: "ok",
        environment_id: environmentId,
        logs,
      }),
    );
  });

  app.get("/desktop-environments/:environmentId/takeover", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const environment = await deps.environmentDal.get({
      tenantId,
      environmentId: c.req.param("environmentId"),
    });
    if (!environment) {
      return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
    }
    if (!environment.takeover_url) {
      return c.json({ error: "conflict", message: "takeover unavailable" }, 409);
    }
    return c.redirect(environment.takeover_url, 302);
  });

  return app;
}
