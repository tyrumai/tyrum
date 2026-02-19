import { describe, expect, it } from "vitest";
import { EventScope, NodeIdentity, NodePairingRequest } from "../src/index.js";

describe("Node contracts", () => {
  it("parses node identity", () => {
    const node = NodeIdentity.parse({
      node_id: "node-1",
      label: "My Mac mini",
      capabilities: ["desktop", "cli"],
      last_seen_at: "2026-02-19T12:00:00Z",
    });
    expect(node.node_id).toBe("node-1");
  });

  it("parses pairing request", () => {
    const req = NodePairingRequest.parse({
      pairing_id: 1,
      status: "pending",
      requested_at: "2026-02-19T12:00:00Z",
      node: {
        node_id: "node-1",
        capabilities: ["desktop"],
        last_seen_at: "2026-02-19T12:00:00Z",
      },
      resolution: null,
      resolved_at: null,
    });
    expect(req.status).toBe("pending");
  });
});

describe("EventScope", () => {
  it("parses key scope", () => {
    const scope = EventScope.parse({
      kind: "key",
      key: "agent:agent-1:telegram-1:main",
      lane: "main",
    });
    expect(scope.kind).toBe("key");
  });
});

