import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF } from "@tyrum/contracts";
const { removeEnvironmentContainerMock } = vi.hoisted(() => ({
  removeEnvironmentContainerMock: vi.fn(async () => {}),
}));

vi.mock("../../src/modules/desktop-environments/docker-cli.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/modules/desktop-environments/docker-cli.js")>();
  return {
    ...actual,
    removeEnvironmentContainer: removeEnvironmentContainerMock,
  };
});

import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";
import { type DesktopEnvironmentLifecycle } from "../../src/modules/desktop-environments/lifecycle-service.js";

describe("desktop environment routes", () => {
  it("reads and updates the configured default image ref", async () => {
    const { app } = await createTestApp();

    const defaultsRes = await app.request("/config/desktop-environments/defaults");
    expect(defaultsRes.status).toBe(200);
    await expect(defaultsRes.json()).resolves.toMatchObject({
      default_image_ref: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      revision: 1,
    });

    const updateRes = await app.request("/config/desktop-environments/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
        reason: "promote stable image",
      }),
    });

    expect(updateRes.status).toBe(200);
    await expect(updateRes.json()).resolves.toMatchObject({
      default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
      revision: 2,
      reason: "promote stable image",
    });
  });

  it("uses the configured default image when image_ref is omitted", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: {
        desktopEnvironments: {
          defaultImageRef: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
        },
      },
    });
    const hostDal = new DesktopEnvironmentHostDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const createRes = await app.request("/desktop-environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host_id: "host-1",
        label: "Research desktop",
        desired_running: false,
      }),
    });

    expect(createRes.status).toBe(201);
    await expect(createRes.json()).resolves.toMatchObject({
      environment: {
        image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
      },
    });
  });

  it("returns conflict when create targets a host without docker availability", async () => {
    const { app, container } = await createTestApp();
    const hostDal = new DesktopEnvironmentHostDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: false,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: "Cannot connect to the Docker daemon",
    });

    const createRes = await app.request("/desktop-environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host_id: "host-1",
        label: "Research desktop",
      }),
    });

    expect(createRes.status).toBe(409);
    await expect(createRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: expect.stringContaining("Cannot connect to the Docker daemon"),
    });
  });

  it("creates, lists, mutates, and reads logs for desktop environments", async () => {
    let environmentDal: DesktopEnvironmentDal;
    const deleteEnvironment = vi.fn<DesktopEnvironmentLifecycle["deleteEnvironment"]>(
      async (input) => await environmentDal.delete(input),
    );
    const { app, container, requestUnauthenticated } = await createTestApp({
      desktopEnvironmentLifecycle: {
        deleteEnvironment,
      },
    });
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const createRes = await app.request("/desktop-environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host_id: "host-1",
        label: "Research desktop",
        image_ref: "registry.example.test/desktop:latest",
        desired_running: false,
      }),
    });
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as { environment: { environment_id: string } };
    const environmentId = createdBody.environment.environment_id;

    const listRes = await app.request("/desktop-environments");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      environments: Array<{ environment_id: string; status: string; desired_running: boolean }>;
    };
    expect(listBody.environments).toHaveLength(1);
    expect(listBody.environments[0]).toMatchObject({
      environment_id: environmentId,
      status: "stopped",
      desired_running: false,
    });

    const resetRes = await app.request(`/desktop-environments/${environmentId}/reset`, {
      method: "POST",
    });
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as {
      environment: { environment_id: string; desired_running: boolean; status: string };
    };
    expect(resetBody.environment).toMatchObject({
      environment_id: environmentId,
      desired_running: false,
      status: "stopped",
    });

    const startRes = await app.request(`/desktop-environments/${environmentId}/start`, {
      method: "POST",
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      environment: { environment_id: string; desired_running: boolean; status: string };
    };
    expect(startBody.environment).toMatchObject({
      environment_id: environmentId,
      desired_running: true,
      status: "starting",
    });

    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId,
      status: "running",
      nodeId: "node-desktop-1",
      takeoverUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime booting", "desktop runtime ready"],
      lastError: null,
    });

    const logsRes = await app.request(`/desktop-environments/${environmentId}/logs`);
    expect(logsRes.status).toBe(200);
    const logsBody = (await logsRes.json()) as { logs: string[] };
    expect(logsBody.logs).toEqual(["desktop runtime booting", "desktop runtime ready"]);

    const createConversationRes = await app.request(
      `/desktop-environments/${environmentId}/takeover-token`,
      {
        method: "POST",
      },
    );
    expect(createConversationRes.status).toBe(200);
    const createConversationBody = (await createConversationRes.json()) as {
      status: string;
      conversation: {
        conversation_id: string;
        entry_url: string;
        expires_at: string;
      };
    };
    expect(createConversationBody).toMatchObject({
      status: "ok",
      conversation: {
        conversation_id: expect.any(String),
        entry_url: expect.stringContaining("/desktop-takeover/s/"),
        expires_at: expect.any(String),
      },
    });
    const takeoverEntryUrl = new URL(createConversationBody.conversation.entry_url);
    expect(takeoverEntryUrl.origin).toBe("http://127.0.0.1:8788");
    expect(takeoverEntryUrl.pathname).toMatch(/^\/desktop-takeover\/s\/.+\/vnc\.html$/u);
    expect(takeoverEntryUrl.searchParams.get("autoconnect")).toBe("true");
    expect(takeoverEntryUrl.searchParams.get("path")).toMatch(
      /^desktop-takeover\/s\/.+\/websockify$/u,
    );

    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe(`http://127.0.0.1:6080/vnc.html${takeoverEntryUrl.search}`);
      return new Response("<html>proxied desktop</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    globalThis.fetch = upstreamFetch;
    try {
      const takeoverRes = await requestUnauthenticated(
        `${takeoverEntryUrl.pathname}${takeoverEntryUrl.search}`,
      );
      expect(takeoverRes.status).toBe(200);
      await expect(takeoverRes.text()).resolves.toBe("<html>proxied desktop</html>");
      const blockedProxyRes = await requestUnauthenticated(
        takeoverEntryUrl.pathname.replace(/\/vnc\.html$/u, "/admin"),
      );
      expect(blockedProxyRes.status).toBe(404);
      await expect(blockedProxyRes.text()).resolves.toBe("desktop takeover path not found");
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const deleteRes = await app.request(`/desktop-environments/${environmentId}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ deleted: true });
    expect(deleteEnvironment).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      environmentId,
    });
  });

  it("requeues an errored environment when the image ref changes", async () => {
    const { app, container } = await createTestApp();
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:broken",
      desiredRunning: true,
    });
    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "error",
      nodeId: "node-desktop-1",
      takeoverUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      logs: ["pull failed"],
      lastError: "pull failed",
    });

    const patchRes = await app.request(`/desktop-environments/${environment.environment_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image_ref: "registry.example.test/desktop:fixed",
      }),
    });

    expect(patchRes.status).toBe(200);
    await expect(patchRes.json()).resolves.toMatchObject({
      environment: {
        environment_id: environment.environment_id,
        image_ref: "registry.example.test/desktop:fixed",
        desired_running: true,
        status: "pending",
        node_id: null,
        last_error: null,
      },
    });
  });

  it("returns conflict when start targets an unavailable host", async () => {
    const { app, container } = await createTestApp();
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: false,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: "Cannot connect to the Docker daemon",
    });

    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: false,
    });

    const startRes = await app.request(
      `/desktop-environments/${environment.environment_id}/start`,
      {
        method: "POST",
      },
    );

    expect(startRes.status).toBe(409);
    await expect(startRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: expect.stringContaining("Cannot connect to the Docker daemon"),
    });
  });

  it("returns a conflict when delete is requested from an edge-only gateway without a lifecycle implementation", async () => {
    const { app, container } = await createTestApp({ runtimeRole: "edge" });
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: false,
    });

    const deleteRes = await app.request(`/desktop-environments/${environment.environment_id}`, {
      method: "DELETE",
    });

    expect(deleteRes.status).toBe(409);
    await expect(deleteRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: expect.stringContaining("role=desktop-runtime"),
    });

    await expect(
      environmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        environmentId: environment.environment_id,
      }),
    ).resolves.toBeTruthy();
  });

  it("uses the default lifecycle service when running role=desktop-runtime", async () => {
    const { app, container } = await createTestApp({ runtimeRole: "desktop-runtime" });
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: false,
    });

    const deleteRes = await app.request(`/desktop-environments/${environment.environment_id}`, {
      method: "DELETE",
    });

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ deleted: true });
    expect(removeEnvironmentContainerMock).toHaveBeenCalledWith(environment.environment_id);
    await expect(
      environmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        environmentId: environment.environment_id,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects takeover conversation creation when the stored upstream URL is invalid", async () => {
    const { app, container } = await createTestApp();
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: true,
    });

    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-desktop-1",
      takeoverUrl: "https://evil.example.test/phish",
      logs: ["desktop runtime ready"],
      lastError: null,
    });

    const takeoverTokenRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover-token`,
      {
        method: "POST",
      },
    );

    expect(takeoverTokenRes.status).toBe(409);
    await expect(takeoverTokenRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: "takeover unavailable",
    });
  });

  it("rejects takeover conversation creation when the environment is not running", async () => {
    const { app, container } = await createTestApp();
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });

    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: true,
    });

    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "starting",
      nodeId: "node-desktop-1",
      takeoverUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime starting"],
      lastError: null,
    });

    const takeoverTokenRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover-token`,
      {
        method: "POST",
      },
    );

    expect(takeoverTokenRes.status).toBe(409);
    await expect(takeoverTokenRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: "takeover unavailable",
    });
  });

  it("returns not found for takeover conversation creation when the desktop environment does not exist", async () => {
    const { app, requestUnauthenticated } = await createTestApp();

    const takeoverTokenRes = await app.request("/desktop-environments/missing-env/takeover-token", {
      method: "POST",
    });
    const proxyRes = await requestUnauthenticated(
      "/desktop-takeover/s/missing-token/vnc.html?autoconnect=true",
    );

    expect(takeoverTokenRes.status).toBe(404);
    await expect(takeoverTokenRes.json()).resolves.toMatchObject({
      error: "not_found",
      message: "desktop environment not found",
    });
    expect(proxyRes.status).toBe(404);
    await expect(proxyRes.text()).resolves.toBe("desktop takeover conversation not found");
  });
});
