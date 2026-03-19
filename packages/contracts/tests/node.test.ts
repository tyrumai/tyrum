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

  const baseReview = {
    review_id: "550e8400-e29b-41d4-a716-446655440111",
    target_type: "pairing",
    target_id: "1",
    reviewer_kind: "guardian",
    reviewer_id: "subagent-1",
    state: "queued",
    reason: null,
    risk_level: null,
    risk_score: null,
    evidence: null,
    decision_payload: null,
    created_at: "2026-02-19T12:00:00Z",
    started_at: null,
    completed_at: null,
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
      status: "queued",
      motivation: "This node connected and needs trust and capability review.",
      requested_at: "2026-02-19T12:00:00Z",
      node: {
        node_id: "node-1",
        capabilities: [{ id: "tyrum.desktop.query", version: "1.0.0" }],
        last_seen_at: "2026-02-19T12:00:00Z",
      },
      latest_review: baseReview,
    });
    expect(req.status).toBe("queued");
  });

  it("rejects pairing request missing motivation", () => {
    expectRejects(NodePairingRequest, {
      pairing_id: 1,
      status: "queued",
      requested_at: "2026-02-19T12:00:00Z",
      node: baseNode,
      latest_review: baseReview,
    });
  });

  it("rejects pairing request missing node", () => {
    const req = {
      pairing_id: 1,
      status: "queued",
      motivation: "This node connected and needs trust and capability review.",
      requested_at: "2026-02-19T12:00:00Z",
      latest_review: baseReview,
    } as const;
    expectRejects(NodePairingRequest, req);
  });

  it("rejects pairing request with wrong pairing_id type", () => {
    expectRejects(NodePairingRequest, {
      pairing_id: "1",
      status: "queued",
      motivation: "This node connected and needs trust and capability review.",
      requested_at: "2026-02-19T12:00:00Z",
      node: baseNode,
      latest_review: baseReview,
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
