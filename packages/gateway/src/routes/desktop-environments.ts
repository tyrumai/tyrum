import { Hono } from "hono";
import {
  describeDesktopEnvironmentHostAvailability,
  DesktopEnvironmentCreateRequest,
  DesktopEnvironmentDeleteResponse,
  DesktopEnvironmentDefaultsResponse,
  DesktopEnvironmentDefaultsUpdateRequest,
  DesktopEnvironmentGetResponse,
  DesktopEnvironmentHostListResponse,
  DesktopEnvironmentListResponse,
  DesktopEnvironmentLogsResponse,
  DesktopEnvironmentMutateResponse,
  DesktopEnvironmentTakeoverResponse,
  isDesktopEnvironmentHostAvailable,
  type DeploymentConfig as DeploymentConfigT,
  DesktopEnvironmentUpdateRequest,
} from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import {
  requireAuthClaims,
  requireOperatorAdminAccess,
  requireTenantId,
} from "../modules/auth/claims.js";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../modules/desktop-environments/dal.js";
import { readDesktopEnvironmentDefaultImageRef } from "../modules/desktop-environments/default-image.js";
import {
  DesktopEnvironmentLifecycleUnavailableError,
  type DesktopEnvironmentLifecycle,
} from "../modules/desktop-environments/lifecycle-service.js";

const TRUSTED_TAKEOVER_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TRUSTED_TAKEOVER_PATH = "/vnc.html";

function requireAdmin(c: { get: (key: string) => unknown }): void {
  requireOperatorAdminAccess(c);
}

function readTrustedTakeoverUrl(value: string | null): string | null {
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    void error;
    return null;
  }

  if (parsed.protocol !== "http:") return null;
  if (!TRUSTED_TAKEOVER_HOSTNAMES.has(parsed.hostname)) return null;
  if (parsed.pathname !== TRUSTED_TAKEOVER_PATH) return null;
  return parsed.toString();
}

export function createDesktopEnvironmentRoutes(deps: {
  db: SqlDb;
  defaultDeploymentConfig: DeploymentConfigT;
  hostDal: DesktopEnvironmentHostDal;
  environmentDal: DesktopEnvironmentDal;
  lifecycleService: DesktopEnvironmentLifecycle;
}): Hono {
  const app = new Hono();
  const deploymentConfigDal = new DeploymentConfigDal(deps.db);

  function describeHostConflict(host: {
    label: string;
    docker_available: boolean;
    healthy: boolean;
    last_error: string | null;
  }): string {
    return `desktop environment host "${host.label}" is unavailable: ${describeDesktopEnvironmentHostAvailability(host)}`;
  }

  function desktopEnvironmentDefaultsResponse(params: {
    defaultImageRef: string;
    revision: number;
    createdAt: string;
    createdBy: unknown;
    reason?: string;
    revertedFromRevision?: number;
  }) {
    return DesktopEnvironmentDefaultsResponse.parse({
      status: "ok",
      default_image_ref: params.defaultImageRef,
      revision: params.revision,
      created_at: params.createdAt,
      created_by: params.createdBy,
      reason: params.reason ?? null,
      reverted_from_revision: params.revertedFromRevision ?? null,
    });
  }

  app.get("/config/desktop-environments/defaults", async (c) => {
    requireAdmin(c);
    const { defaultImageRef, revision } = await readDesktopEnvironmentDefaultImageRef({
      deploymentConfigDal,
      defaultConfig: deps.defaultDeploymentConfig,
    });
    return c.json(
      desktopEnvironmentDefaultsResponse({
        defaultImageRef,
        revision: revision.revision,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        reason: revision.reason,
        revertedFromRevision: revision.revertedFromRevision,
      }),
    );
  });

  app.put("/config/desktop-environments/defaults", async (c) => {
    requireAdmin(c);
    const claims = requireAuthClaims(c);
    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (error) {
      void error;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }
    const parsed = DesktopEnvironmentDefaultsUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const currentRevision = await deploymentConfigDal.ensureSeeded({
      defaultConfig: deps.defaultDeploymentConfig,
      createdBy: { kind: "bootstrap" },
      reason: "seed",
    });
    const revision = await deploymentConfigDal.set({
      config: {
        ...currentRevision.config,
        desktopEnvironments: {
          ...currentRevision.config.desktopEnvironments,
          defaultImageRef: parsed.data.default_image_ref,
        },
      },
      createdBy: { kind: "tenant.token", token_id: claims.token_id },
      reason: parsed.data.reason,
    });

    return c.json(
      desktopEnvironmentDefaultsResponse({
        defaultImageRef: revision.config.desktopEnvironments.defaultImageRef,
        revision: revision.revision,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
        reason: revision.reason,
        revertedFromRevision: revision.revertedFromRevision,
      }),
    );
  });

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
    if (!isDesktopEnvironmentHostAvailable(host)) {
      return c.json({ error: "conflict", message: describeHostConflict(host) }, 409);
    }
    const { defaultImageRef } = await readDesktopEnvironmentDefaultImageRef({
      deploymentConfigDal,
      defaultConfig: deps.defaultDeploymentConfig,
    });
    const environment = await deps.environmentDal.create({
      tenantId,
      hostId: parsed.data.host_id,
      label: parsed.data.label,
      imageRef: parsed.data.image_ref ?? defaultImageRef,
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
    let deleted: boolean;
    try {
      deleted = await deps.lifecycleService.deleteEnvironment({
        tenantId,
        environmentId: c.req.param("environmentId"),
      });
    } catch (error) {
      if (error instanceof DesktopEnvironmentLifecycleUnavailableError) {
        return c.json({ error: "conflict", message: error.message }, 409);
      }
      throw error;
    }
    return c.json(DesktopEnvironmentDeleteResponse.parse({ status: "ok", deleted }));
  });

  for (const action of ["start", "stop", "reset"] as const) {
    app.post(`/desktop-environments/:environmentId/${action}`, async (c) => {
      requireAdmin(c);
      const tenantId = requireTenantId(c);
      const environmentId = c.req.param("environmentId");
      if (action === "start") {
        const existing = await deps.environmentDal.get({ tenantId, environmentId });
        if (!existing) {
          return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
        }
        const host = await deps.hostDal.get(existing.host_id);
        if (!host) {
          return c.json(
            {
              error: "conflict",
              message: `desktop environment host "${existing.host_id}" is unavailable: host not found`,
            },
            409,
          );
        }
        if (!isDesktopEnvironmentHostAvailable(host)) {
          return c.json({ error: "conflict", message: describeHostConflict(host) }, 409);
        }
      }
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

  app.get("/desktop-environments/:environmentId/takeover-url", async (c) => {
    requireAdmin(c);
    const tenantId = requireTenantId(c);
    const environment = await deps.environmentDal.get({
      tenantId,
      environmentId: c.req.param("environmentId"),
    });
    if (!environment) {
      return c.json({ error: "not_found", message: "desktop environment not found" }, 404);
    }
    const takeoverUrl = readTrustedTakeoverUrl(environment.takeover_url);
    if (!takeoverUrl) {
      return c.json({ error: "conflict", message: "takeover unavailable" }, 409);
    }
    return c.json(
      DesktopEnvironmentTakeoverResponse.parse({
        status: "ok",
        takeover_url: takeoverUrl,
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
    const takeoverUrl = readTrustedTakeoverUrl(environment.takeover_url);
    if (!takeoverUrl) {
      return c.json({ error: "conflict", message: "takeover unavailable" }, 409);
    }
    return c.redirect(takeoverUrl, 302);
  });

  return app;
}
