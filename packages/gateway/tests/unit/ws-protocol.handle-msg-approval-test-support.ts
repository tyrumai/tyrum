import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { makeDeps, makeClient } from "./ws-protocol.test-support.js";

/**
 * Ping tests for handleClientMessage.
 * Must be called inside a `describe("handleClientMessage")` block.
 */
function registerPingTests(): void {
  it("does not update lastWsPongAt on ping response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    client.lastWsPongAt = 1000;

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-1", type: "ping", ok: true }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(client.lastWsPongAt).toBe(1000);
  });

  it("responds to ping requests without updating lastWsPongAt", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    client.lastWsPongAt = 1000;
    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-req-1", type: "ping", payload: {} }),
      deps,
    );

    expect(result).toEqual({
      request_id: "ping-req-1",
      type: "ping",
      ok: true,
    });
    expect(client.lastWsPongAt).toBe(1000);
  });
}

export function registerHandleMessageApprovalTests(): void {
  registerPingTests();
}
