import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF } from "@tyrum/schemas";
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
  it("uses the shared default image when image_ref is omitted", async () => {
    const { app, container } = await createTestApp();
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
        image_ref: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      },
    });
  });

  it("creates, lists, mutates, and reads logs for desktop environments", async () => {
    let environmentDal: DesktopEnvironmentDal;
    const deleteEnvironment = vi.fn<DesktopEnvironmentLifecycle["deleteEnvironment"]>(
      async (input) => await environmentDal.delete(input),
    );
    const { app, container } = await createTestApp({
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

    const takeoverRes = await app.request(`/desktop-environments/${environmentId}/takeover`, {
      redirect: "manual",
    });
    expect(takeoverRes.status).toBe(302);
    expect(takeoverRes.headers.get("location")).toBe(
      "http://127.0.0.1:6080/vnc.html?autoconnect=true",
    );

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

  it("rejects takeover redirects that do not point at a trusted local runtime", async () => {
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

    const takeoverRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover`,
      {
        redirect: "manual",
      },
    );

    expect(takeoverRes.status).toBe(409);
    expect(takeoverRes.headers.get("location")).toBeNull();
    await expect(takeoverRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: "takeover unavailable",
    });
  });
});
