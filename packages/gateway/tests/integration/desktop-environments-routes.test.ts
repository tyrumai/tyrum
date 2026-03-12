import { describe, expect, it } from "vitest";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

describe("desktop environment routes", () => {
  it("creates, lists, mutates, and reads logs for desktop environments", async () => {
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
  });
});
