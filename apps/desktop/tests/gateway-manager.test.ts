import { describe, expect, it } from "vitest";
import {
  GatewayManager,
  type GatewayStatus,
} from "../src/main/gateway-manager.js";

describe("GatewayManager", () => {
  it("status starts as 'stopped'", () => {
    const gm = new GatewayManager();
    expect(gm.status).toBe("stopped");
  });

  it("stop() on a stopped manager is a no-op", async () => {
    const gm = new GatewayManager();
    await gm.stop();
    expect(gm.status).toBe("stopped");
  });

  it("start() when already running throws", async () => {
    const gm = new GatewayManager();

    // Simulate an already-running state by setting the private process field
    // to a truthy value via type assertion. This avoids spawning a real process.
    const internal = gm as unknown as { process: unknown };
    internal.process = {};

    await expect(
      gm.start({
        gatewayBin: "/nonexistent",
        port: 9999,
        dbPath: "/tmp/test.db",
        wsToken: "test-token",
      }),
    ).rejects.toThrow("Gateway already running");
  });

  it("emits status-change events", () => {
    const gm = new GatewayManager();
    const statuses: GatewayStatus[] = [];
    gm.on("status-change", (s) => statuses.push(s));

    // Trigger internal setStatus via stop() which won't emit because
    // process is null. We can verify the event mechanism works by
    // calling setStatus directly.
    const internal = gm as unknown as { setStatus(s: GatewayStatus): void };
    internal.setStatus("starting");
    internal.setStatus("running");
    internal.setStatus("stopped");

    expect(statuses).toEqual(["starting", "running", "stopped"]);
  });
});
