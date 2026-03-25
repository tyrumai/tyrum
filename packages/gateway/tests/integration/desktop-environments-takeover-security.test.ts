import { describe, expect, it } from "vitest";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

describe("desktop environment takeover session security", () => {
  it("allows takeover session creation for IPv6 loopback upstreams", async () => {
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
      takeoverUrl: "http://[::1]:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime ready"],
      lastError: null,
    });

    const takeoverSessionRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover-session`,
      {
        method: "POST",
      },
    );

    expect(takeoverSessionRes.status).toBe(200);
    await expect(takeoverSessionRes.json()).resolves.toMatchObject({
      status: "ok",
      session: {
        entry_url: expect.stringContaining("/desktop-takeover/s/"),
      },
    });
  });

  it("rejects takeover session creation when the stored upstream host is outside the allowed origin", async () => {
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
      takeoverUrl: "https://evil.example.test:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime ready"],
      lastError: null,
    });

    const takeoverSessionRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover-session`,
      {
        method: "POST",
      },
    );

    expect(takeoverSessionRes.status).toBe(409);
    await expect(takeoverSessionRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: "takeover unavailable",
    });
  });

  it("allows takeover session creation for the configured remote advertise origin", async () => {
    const { app, container } = await createTestApp({
      desktopTakeoverAdvertiseOrigin: "https://desktop-host.example.test",
    });
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
      takeoverUrl: "https://desktop-host.example.test:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime ready"],
      lastError: null,
    });

    const takeoverSessionRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover-session`,
      {
        method: "POST",
      },
    );

    expect(takeoverSessionRes.status).toBe(200);
    await expect(takeoverSessionRes.json()).resolves.toMatchObject({
      status: "ok",
      session: {
        entry_url: expect.stringContaining("/desktop-takeover/s/"),
      },
    });
  });

  it("rejects remote takeover upstreams when a programmatic advertise origin includes a port", async () => {
    const { app, container } = await createTestApp({
      desktopTakeoverAdvertiseOrigin: "https://desktop-host.example.test:8443",
    });
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
      takeoverUrl: "https://desktop-host.example.test:6080/vnc.html?autoconnect=true",
      logs: ["desktop runtime ready"],
      lastError: null,
    });

    const takeoverSessionRes = await app.request(
      `/desktop-environments/${environment.environment_id}/takeover-session`,
      {
        method: "POST",
      },
    );

    expect(takeoverSessionRes.status).toBe(409);
    await expect(takeoverSessionRes.json()).resolves.toMatchObject({
      error: "conflict",
      message: "takeover unavailable",
    });
  });
});
