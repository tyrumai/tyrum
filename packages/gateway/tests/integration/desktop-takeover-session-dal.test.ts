import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DesktopTakeoverSessionDal } from "../../src/modules/desktop-environments/takeover-session-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "./helpers.js";

describe("desktop takeover session dal", () => {
  let cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.map(async (close) => await close()));
    cleanup = [];
  });

  it("purges expired sessions before creating a new session", async () => {
    const container = await createTestContainer();
    cleanup.push(async () => {
      await container.db.close();
    });

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);
    const sessionDal = new DesktopTakeoverSessionDal(container.db);

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

    await sessionDal.create({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      upstreamUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const beforeActiveCreate = await container.db.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM desktop_takeover_sessions",
    );
    expect(beforeActiveCreate?.total).toBe(1);

    const activeSession = await sessionDal.create({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      upstreamUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const rows = await container.db.all<{ session_id: string; expires_at: string }>(
      `SELECT session_id, expires_at
       FROM desktop_takeover_sessions
       ORDER BY created_at ASC`,
    );
    expect(rows).toEqual([
      {
        session_id: activeSession.sessionId,
        expires_at: activeSession.expiresAt,
      },
    ]);
  });
});
