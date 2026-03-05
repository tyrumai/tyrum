import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeploymentConfig } from "@tyrum/schemas";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const approvalRouteCtor = vi.fn();
const pairingRouteCtor = vi.fn();

vi.mock("../../src/routes/approval.js", () => ({
  createApprovalRoutes: (deps: unknown) => {
    approvalRouteCtor(deps);
    return new Hono();
  },
}));

vi.mock("../../src/routes/pairing.js", () => ({
  createPairingRoutes: (deps: unknown) => {
    pairingRouteCtor(deps);
    return new Hono();
  },
}));

describe("createApp WS backpressure wiring", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    approvalRouteCtor.mockClear();
    pairingRouteCtor.mockClear();
  });

  it("passes deployment websocket.maxBufferedBytes into approval and pairing routes", async () => {
    container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({ websocket: { maxBufferedBytes: 8192 } }) },
    );

    const connectionManager = new ConnectionManager();
    const { createApp } = await import("../../src/app.js");
    createApp(container, { connectionManager });

    expect(pairingRouteCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        logger: container.logger,
        ws: expect.objectContaining({
          connectionManager,
          maxBufferedBytes: 8192,
        }),
      }),
    );
    expect(approvalRouteCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        logger: container.logger,
        ws: expect.objectContaining({
          connectionManager,
          maxBufferedBytes: 8192,
        }),
      }),
    );
  });
});
