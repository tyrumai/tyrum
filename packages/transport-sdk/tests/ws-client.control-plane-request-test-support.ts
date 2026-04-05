import { expect, it } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/contracts";
import type { TyrumClient } from "../src/ws-client.js";
import { waitForMessage } from "./ws-client.test-support.js";
import {
  connectControlPlaneClient,
  type ControlPlaneFixture,
  type ControlPlaneSocket,
} from "./ws-client.control-plane-shared.js";

function createCapabilityDescriptor() {
  return {
    id: descriptorIdForClientCapability("playwright"),
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  };
}

function createPairingResult(status: "approved" | "denied" | "revoked") {
  const capability = createCapabilityDescriptor();
  const reviewDetails =
    status === "approved"
      ? {
          review_id: "550e8400-e29b-41d4-a716-446655440111",
          reviewer_kind: "human",
          reviewer_id: "operator-1",
          reason: "looks good",
          risk_level: "low",
          risk_score: 10,
          created_at: "2026-02-21T12:00:10Z",
          started_at: "2026-02-21T12:00:10Z",
          completed_at: "2026-02-21T12:00:10Z",
        }
      : status === "denied"
        ? {
            review_id: "550e8400-e29b-41d4-a716-446655440112",
            reviewer_kind: "human",
            reviewer_id: "operator-1",
            reason: "not trusted",
            risk_level: "high",
            risk_score: 900,
            created_at: "2026-02-21T12:00:11Z",
            started_at: "2026-02-21T12:00:11Z",
            completed_at: "2026-02-21T12:00:11Z",
          }
        : {
            review_id: "550e8400-e29b-41d4-a716-446655440113",
            reviewer_kind: "system",
            reviewer_id: null,
            reason: "removed",
            risk_level: null,
            risk_score: null,
            created_at: "2026-02-21T12:00:12Z",
            started_at: "2026-02-21T12:00:12Z",
            completed_at: "2026-02-21T12:00:12Z",
          };

  return {
    pairing: {
      pairing_id: 11,
      status,
      motivation:
        status === "approved"
          ? "This node was reviewed and approved."
          : status === "denied"
            ? "This node was reviewed and denied."
            : "This node pairing was revoked.",
      ...(status === "approved" ? { trust_level: "remote" as const } : {}),
      requested_at: "2026-02-21T12:00:00Z",
      node: {
        node_id: "node-1",
        capabilities: [capability],
        last_seen_at: "2026-02-21T12:00:00Z",
      },
      capability_allowlist: status === "approved" ? [capability] : [],
      latest_review: {
        target_type: "pairing",
        target_id: "11",
        state: status,
        evidence: null,
        decision_payload: null,
        ...reviewDetails,
      },
    },
  };
}

async function waitForTypedRequest(
  ws: ControlPlaneSocket,
  expectedType: string,
): Promise<Record<string, unknown>> {
  const request = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(request["type"]).toBe(expectedType);
  return request;
}

function sendOkResponse(input: {
  ws: ControlPlaneSocket;
  request: Record<string, unknown>;
  type: string;
  result?: unknown;
}): void {
  input.ws.send(
    JSON.stringify({
      request_id: input.request["request_id"],
      type: input.type,
      ok: true,
      ...(typeof input.result === "undefined" ? {} : { result: input.result }),
    }),
  );
}

async function expectTurnListRequest(client: TyrumClient, ws: ControlPlaneSocket): Promise<void> {
  const pending = client.turnList({ statuses: ["queued"], limit: 1 });
  const request = await waitForTypedRequest(ws, "turn.list");
  sendOkResponse({
    ws,
    request,
    type: "turn.list",
    result: {
      turns: [
        {
          turn: {
            turn_id: "550e8400-e29b-41d4-a716-446655440000",
            job_id: "550e8400-e29b-41d4-a716-446655440010",
            conversation_key: "agent:agent-1:main",
            status: "queued",
            attempt: 1,
            created_at: "2026-02-21T12:00:00Z",
            started_at: null,
            finished_at: null,
          },
          agent_key: "agent-1",
          conversation_key: "agent:agent-1:main",
        },
      ],
      steps: [],
      attempts: [],
    },
  });

  await expect(pending).resolves.toEqual({
    turns: [
      {
        turn: {
          turn_id: "550e8400-e29b-41d4-a716-446655440000",
          job_id: "550e8400-e29b-41d4-a716-446655440010",
          conversation_key: "agent:agent-1:main",
          status: "queued",
          attempt: 1,
          created_at: "2026-02-21T12:00:00Z",
          started_at: null,
          finished_at: null,
        },
        agent_key: "agent-1",
        conversation_key: "agent:agent-1:main",
      },
    ],
    steps: [],
    attempts: [],
  });
}

async function expectWorkflowRequests(client: TyrumClient, ws: ControlPlaneSocket): Promise<void> {
  const startPending = client.workflowStart({
    conversation_key: "agent:agent-1:main",
    steps: [{ type: "Http", args: { url: "https://example.com" } }],
  });
  const startRequest = await waitForTypedRequest(ws, "workflow.start");
  sendOkResponse({
    ws,
    request: startRequest,
    type: "workflow.start",
    result: {
      job_id: "job-1",
      turn_id: "550e8400-e29b-41d4-a716-446655440000",
      plan_id: "plan-1",
      request_id: "req-1",
      conversation_key: "agent:agent-1:main",
      steps_count: 1,
    },
  });
  await expect(startPending).resolves.toEqual({
    job_id: "job-1",
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
    plan_id: "plan-1",
    request_id: "req-1",
    conversation_key: "agent:agent-1:main",
    steps_count: 1,
  });

  const resumePending = client.workflowResume({ token: "resume-token-1" });
  const resumeRequest = await waitForTypedRequest(ws, "workflow.resume");
  sendOkResponse({
    ws,
    request: resumeRequest,
    type: "workflow.resume",
    result: { turn_id: "550e8400-e29b-41d4-a716-446655440000" },
  });
  await expect(resumePending).resolves.toEqual({
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
  });

  const cancelPending = client.workflowCancel({
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
    reason: "operator cancel",
  });
  const cancelRequest = await waitForTypedRequest(ws, "workflow.cancel");
  sendOkResponse({
    ws,
    request: cancelRequest,
    type: "workflow.cancel",
    result: { turn_id: "550e8400-e29b-41d4-a716-446655440000", cancelled: true },
  });
  await expect(cancelPending).resolves.toEqual({
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
    cancelled: true,
  });
}

async function expectPairingRequests(client: TyrumClient, ws: ControlPlaneSocket): Promise<void> {
  const approvedPairing = createPairingResult("approved");
  const deniedPairing = createPairingResult("denied");
  const revokedPairing = createPairingResult("revoked");

  const approvePending = client.pairingApprove({
    pairing_id: 11,
    trust_level: "remote",
    capability_allowlist: [createCapabilityDescriptor()],
  });
  const approveRequest = await waitForTypedRequest(ws, "pairing.approve");
  sendOkResponse({
    ws,
    request: approveRequest,
    type: "pairing.approve",
    result: approvedPairing,
  });
  await expect(approvePending).resolves.toEqual(approvedPairing);

  const denyPending = client.pairingDeny({ pairing_id: 11, reason: "denied" });
  const denyRequest = await waitForTypedRequest(ws, "pairing.deny");
  sendOkResponse({
    ws,
    request: denyRequest,
    type: "pairing.deny",
    result: deniedPairing,
  });
  await expect(denyPending).resolves.toEqual(deniedPairing);

  const revokePending = client.pairingRevoke({ pairing_id: 11, reason: "revoked" });
  const revokeRequest = await waitForTypedRequest(ws, "pairing.revoke");
  sendOkResponse({
    ws,
    request: revokeRequest,
    type: "pairing.revoke",
    result: revokedPairing,
  });
  await expect(revokePending).resolves.toEqual(revokedPairing);
}

async function expectPresenceRequests(client: TyrumClient, ws: ControlPlaneSocket): Promise<void> {
  const beaconPending = client.presenceBeacon({
    mode: "ui",
    host: "operator-host",
    last_input_seconds: 5,
  });
  const beaconRequest = await waitForTypedRequest(ws, "presence.beacon");
  sendOkResponse({
    ws,
    request: beaconRequest,
    type: "presence.beacon",
    result: {
      entry: {
        instance_id: "instance-1",
        role: "client",
        host: "operator-host",
        mode: "ui",
        last_seen_at: "2026-02-21T12:01:00Z",
      },
    },
  });
  await expect(beaconPending).resolves.toEqual({
    entry: {
      instance_id: "instance-1",
      role: "client",
      host: "operator-host",
      mode: "ui",
      last_seen_at: "2026-02-21T12:01:00Z",
    },
  });

  const locationPending = client.locationBeacon({
    sample_id: "11111111-1111-4111-8111-111111111111",
    recorded_at: "2026-02-21T12:01:05Z",
    coords: {
      latitude: 52.37,
      longitude: 4.89,
      accuracy_m: 12,
    },
    source: "gps",
    is_background: false,
  });
  const locationRequest = await waitForTypedRequest(ws, "location.beacon");
  sendOkResponse({
    ws,
    request: locationRequest,
    type: "location.beacon",
    result: {
      sample: {
        sample_id: "11111111-1111-4111-8111-111111111111",
        agent_key: "default",
        node_id: "node-1",
        recorded_at: "2026-02-21T12:01:05Z",
        coords: {
          latitude: 52.37,
          longitude: 4.89,
          accuracy_m: 12,
        },
        source: "gps",
        is_background: false,
        accepted: true,
      },
      events: [],
    },
  });
  await expect(locationPending).resolves.toEqual({
    sample: {
      sample_id: "11111111-1111-4111-8111-111111111111",
      agent_key: "default",
      node_id: "node-1",
      recorded_at: "2026-02-21T12:01:05Z",
      coords: {
        latitude: 52.37,
        longitude: 4.89,
        accuracy_m: 12,
      },
      source: "gps",
      is_background: false,
      accepted: true,
    },
    events: [],
  });
}

async function expectCapabilityAndEvidenceRequests(
  client: TyrumClient,
  ws: ControlPlaneSocket,
): Promise<void> {
  const readyPending = client.capabilityReady({
    capabilities: [createCapabilityDescriptor()],
  });
  const readyRequest = await waitForTypedRequest(ws, "capability.ready");
  sendOkResponse({
    ws,
    request: readyRequest,
    type: "capability.ready",
  });
  await expect(readyPending).resolves.toBeUndefined();

  const evidencePending = client.attemptEvidence({
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
    dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    evidence: { logs: ["ok"] },
  });
  const evidenceRequest = await waitForTypedRequest(ws, "attempt.evidence");
  sendOkResponse({
    ws,
    request: evidenceRequest,
    type: "attempt.evidence",
  });
  await expect(evidencePending).resolves.toBeUndefined();
}

export function registerControlPlaneRequestTests(fixture: ControlPlaneFixture): void {
  it("sends typed workflow/pairing/presence/capability requests", async () => {
    const { client, ws } = await connectControlPlaneClient({
      fixture,
      capabilities: ["playwright"],
    });

    await expectTurnListRequest(client, ws);
    await expectWorkflowRequests(client, ws);
    await expectPairingRequests(client, ws);
    await expectPresenceRequests(client, ws);
    await expectCapabilityAndEvidenceRequests(client, ws);
  });
}
