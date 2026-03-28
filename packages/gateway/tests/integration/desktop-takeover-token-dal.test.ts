import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DesktopTakeoverTokenDal } from "../../src/modules/desktop-environments/takeover-token-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "./helpers.js";

describe("desktop takeover conversation dal", () => {
  let cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.map(async (close) => await close()));
    cleanup = [];
  });

  it("purges expired conversations before creating a new conversation", async () => {
    const container = await createTestContainer();
    cleanup.push(async () => {
      await container.db.close();
    });

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);
    const conversationDal = new DesktopTakeoverTokenDal(container.db);

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

    await conversationDal.create({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      upstreamUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const beforeActiveCreate = await container.db.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM desktop_takeover_conversations",
    );
    expect(beforeActiveCreate?.total).toBe(1);

    const activeConversation = await conversationDal.create({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      upstreamUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const rows = await container.db.all<{ conversation_id: string; expires_at: string }>(
      `SELECT conversation_id, expires_at
       FROM desktop_takeover_conversations
       ORDER BY created_at ASC`,
    );
    expect(rows).toEqual([
      {
        conversation_id: activeConversation.conversationId,
        expires_at: activeConversation.expiresAt,
      },
    ]);
  });
});
