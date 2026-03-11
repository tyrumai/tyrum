import { describe, expect, it } from "vitest";
import { EventScope, NodeIdentity, NodePairingRequest } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Node contracts", () => {
  const baseNode = {
    node_id: "node-1",
    label: "My Mac mini",
    capabilities: [
      { id: "tyrum.desktop.query", version: "1.0.0" },
      { id: "tyrum.cli", version: "1.0.0" },
    ],
    last_seen_at: "2026-02-19T12:00:00Z",
  } as const;

  it("parses node identity", () => {
    const node = NodeIdentity.parse(baseNode);
    expect(node.node_id).toBe("node-1");
  });

  it("rejects node identity missing node_id", () => {
    const bad = { ...baseNode } as Record<string, unknown>;
    delete bad.node_id;
    expectRejects(NodeIdentity, bad);
  });

  it("rejects node identity with capabilities that are not an array", () => {
    expectRejects(NodeIdentity, { ...baseNode, capabilities: "desktop" });
  });

  it("parses pairing request", () => {
    const req = NodePairingRequest.parse({
      pairing_id: 1,
      status: "pending",
      requested_at: "2026-02-19T12:00:00Z",
      node: {
        node_id: "node-1",
        capabilities: [{ id: "tyrum.desktop.query", version: "1.0.0" }],
        last_seen_at: "2026-02-19T12:00:00Z",
      },
      resolution: null,
      resolved_at: null,
    });
    expect(req.status).toBe("pending");
  });

  it("rejects pending pairing requests with non-null resolution", () => {
    expectRejects(NodePairingRequest, {
      pairing_id: 1,
      status: "pending",
      requested_at: "2026-02-19T12:00:00Z",
      node: baseNode,
      resolution: { decision: "approved", resolved_at: "2026-02-19T12:00:00Z" },
      resolved_at: null,
    });
  });

  it("rejects non-pending pairing requests with resolution: null", () => {
    expectRejects(NodePairingRequest, {
      pairing_id: 1,
      status: "approved",
      requested_at: "2026-02-19T12:00:00Z",
      node: baseNode,
      resolution: null,
      resolved_at: null,
    });
  });

  it("rejects pairing request missing node", () => {
    const req = {
      pairing_id: 1,
      status: "pending",
      requested_at: "2026-02-19T12:00:00Z",
      resolution: null,
      resolved_at: null,
    } as const;
    expectRejects(NodePairingRequest, req);
  });

  it("rejects pairing request with wrong pairing_id type", () => {
    expectRejects(NodePairingRequest, {
      pairing_id: "1",
      status: "pending",
      requested_at: "2026-02-19T12:00:00Z",
      node: baseNode,
      resolution: null,
      resolved_at: null,
    });
  });
});

describe("EventScope", () => {
  it("parses key scope", () => {
    const scope = EventScope.parse({
      kind: "key",
      key: "agent:agent-1:main",
      lane: "main",
    });
    expect(scope.kind).toBe("key");
  });

  it("rejects scope missing kind", () => {
    expectRejects(EventScope, { key: "agent:agent-1:main", lane: "main" });
  });

  it("rejects scope with invalid kind", () => {
    expectRejects(EventScope, { kind: "nope", key: "agent:agent-1:main" });
  });
});
