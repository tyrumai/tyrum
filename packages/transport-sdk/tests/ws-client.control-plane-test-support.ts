import { expect, it } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/contracts";
import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  createTestServer,
  waitForMessage,
  acceptConnect,
  delay,
} from "./ws-client.test-support.js";

type ControlPlaneFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

function registerControlPlaneWorkflowTests(fixture: ControlPlaneFixture): void {
  it("sends typed workflow/pairing/presence/capability requests", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["playwright"],
      reconnect: false,
    });
    fixture.setClient(client);

    const approvedPairing = {
      pairing: {
        pairing_id: 11,
        status: "approved",
        motivation: "This node was reviewed and approved.",
        trust_level: "remote",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: [
            {
              id: descriptorIdForClientCapability("playwright"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [
          {
            id: descriptorIdForClientCapability("playwright"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
        latest_review: {
          review_id: "550e8400-e29b-41d4-a716-446655440111",
          target_type: "pairing",
          target_id: "11",
          reviewer_kind: "human",
          reviewer_id: "operator-1",
          state: "approved",
          reason: "looks good",
          risk_level: "low",
          risk_score: 10,
          evidence: null,
          decision_payload: null,
          created_at: "2026-02-21T12:00:10Z",
          started_at: "2026-02-21T12:00:10Z",
          completed_at: "2026-02-21T12:00:10Z",
        },
      },
    };

    const deniedPairing = {
      pairing: {
        pairing_id: 11,
        status: "denied",
        motivation: "This node was reviewed and denied.",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: [
            {
              id: descriptorIdForClientCapability("playwright"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [],
        latest_review: {
          review_id: "550e8400-e29b-41d4-a716-446655440112",
          target_type: "pairing",
          target_id: "11",
          reviewer_kind: "human",
          reviewer_id: "operator-1",
          state: "denied",
          reason: "not trusted",
          risk_level: "high",
          risk_score: 900,
          evidence: null,
          decision_payload: null,
          created_at: "2026-02-21T12:00:11Z",
          started_at: "2026-02-21T12:00:11Z",
          completed_at: "2026-02-21T12:00:11Z",
        },
      },
    };

    const revokedPairing = {
      pairing: {
        pairing_id: 11,
        status: "revoked",
        motivation: "This node pairing was revoked.",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: [
            {
              id: descriptorIdForClientCapability("playwright"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [],
        latest_review: {
          review_id: "550e8400-e29b-41d4-a716-446655440113",
          target_type: "pairing",
          target_id: "11",
          reviewer_kind: "system",
          reviewer_id: null,
          state: "revoked",
          reason: "removed",
          risk_level: null,
          risk_score: null,
          evidence: null,
          decision_payload: null,
          created_at: "2026-02-21T12:00:12Z",
          started_at: "2026-02-21T12:00:12Z",
          completed_at: "2026-02-21T12:00:12Z",
        },
      },
    };

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const runP = client.workflowRun({
      key: "agent:agent-1:main",
      steps: [{ type: "Http", args: { url: "https://example.com" } }],
    });
    const runReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(runReq["type"]).toBe("workflow.run");
    ws.send(
      JSON.stringify({
        request_id: runReq["request_id"],
        type: "workflow.run",
        ok: true,
        result: {
          job_id: "job-1",
          run_id: "run-1",
          plan_id: "plan-1",
          request_id: "req-1",
          key: "agent:agent-1:main",
          lane: "main",
          steps_count: 1,
        },
      }),
    );
    await expect(runP).resolves.toEqual({
      job_id: "job-1",
      run_id: "run-1",
      plan_id: "plan-1",
      request_id: "req-1",
      key: "agent:agent-1:main",
      lane: "main",
      steps_count: 1,
    });

    const resumeP = client.workflowResume({ token: "resume-token-1" });
    const resumeReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(resumeReq["type"]).toBe("workflow.resume");
    ws.send(
      JSON.stringify({
        request_id: resumeReq["request_id"],
        type: "workflow.resume",
        ok: true,
        result: { run_id: "run-1" },
      }),
    );
    await expect(resumeP).resolves.toEqual({ run_id: "run-1" });

    const cancelP = client.workflowCancel({ run_id: "run-1", reason: "operator cancel" });
    const cancelReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(cancelReq["type"]).toBe("workflow.cancel");
    ws.send(
      JSON.stringify({
        request_id: cancelReq["request_id"],
        type: "workflow.cancel",
        ok: true,
        result: { run_id: "run-1", cancelled: true },
      }),
    );
    await expect(cancelP).resolves.toEqual({ run_id: "run-1", cancelled: true });

    const approveP = client.pairingApprove({
      pairing_id: 11,
      trust_level: "remote",
      capability_allowlist: [
        {
          id: descriptorIdForClientCapability("playwright"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });
    const approveReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(approveReq["type"]).toBe("pairing.approve");
    ws.send(
      JSON.stringify({
        request_id: approveReq["request_id"],
        type: "pairing.approve",
        ok: true,
        result: approvedPairing,
      }),
    );
    await expect(approveP).resolves.toEqual(approvedPairing);

    const denyP = client.pairingDeny({ pairing_id: 11, reason: "denied" });
    const denyReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(denyReq["type"]).toBe("pairing.deny");
    ws.send(
      JSON.stringify({
        request_id: denyReq["request_id"],
        type: "pairing.deny",
        ok: true,
        result: deniedPairing,
      }),
    );
    await expect(denyP).resolves.toEqual(deniedPairing);

    const revokeP = client.pairingRevoke({ pairing_id: 11, reason: "revoked" });
    const revokeReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(revokeReq["type"]).toBe("pairing.revoke");
    ws.send(
      JSON.stringify({
        request_id: revokeReq["request_id"],
        type: "pairing.revoke",
        ok: true,
        result: revokedPairing,
      }),
    );
    await expect(revokeP).resolves.toEqual(revokedPairing);

    const beaconP = client.presenceBeacon({
      mode: "ui",
      host: "operator-host",
      last_input_seconds: 5,
    });
    const beaconReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(beaconReq["type"]).toBe("presence.beacon");
    ws.send(
      JSON.stringify({
        request_id: beaconReq["request_id"],
        type: "presence.beacon",
        ok: true,
        result: {
          entry: {
            instance_id: "instance-1",
            role: "client",
            host: "operator-host",
            mode: "ui",
            last_seen_at: "2026-02-21T12:01:00Z",
          },
        },
      }),
    );
    await expect(beaconP).resolves.toEqual({
      entry: {
        instance_id: "instance-1",
        role: "client",
        host: "operator-host",
        mode: "ui",
        last_seen_at: "2026-02-21T12:01:00Z",
      },
    });

    const locationBeaconP = client.locationBeacon({
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
    const locationBeaconReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(locationBeaconReq["type"]).toBe("location.beacon");
    ws.send(
      JSON.stringify({
        request_id: locationBeaconReq["request_id"],
        type: "location.beacon",
        ok: true,
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
      }),
    );
    await expect(locationBeaconP).resolves.toEqual({
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

    const readyP = client.capabilityReady({
      capabilities: [
        {
          id: descriptorIdForClientCapability("playwright"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });
    const readyReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(readyReq["type"]).toBe("capability.ready");
    ws.send(
      JSON.stringify({
        request_id: readyReq["request_id"],
        type: "capability.ready",
        ok: true,
      }),
    );
    await expect(readyP).resolves.toBeUndefined();

    const evidenceP = client.attemptEvidence({
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      evidence: { logs: ["ok"] },
    });
    const evidenceReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(evidenceReq["type"]).toBe("attempt.evidence");
    ws.send(
      JSON.stringify({
        request_id: evidenceReq["request_id"],
        type: "attempt.evidence",
        ok: true,
      }),
    );
    await expect(evidenceP).resolves.toBeUndefined();
  });
}

function registerControlPlaneErrorTests(fixture: ControlPlaneFixture): void {
  it("rejects void helper responses with non-empty ack payloads", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const pending = client.ping();
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("ping");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "ping",
        ok: true,
        result: { unexpected: true },
      }),
    );

    await expect(pending).rejects.toThrow(/returned invalid result/i);
  });

  it("rejects helper request when response type mismatches", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const pending = client.commandExecute("/help");
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("command.execute");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "workflow.run",
        ok: true,
        result: {
          job_id: "job-1",
        },
      }),
    );

    await expect(pending).rejects.toThrow(/mismatched response type/i);
  });

  it("rejects pending requests immediately on disconnect", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const pending = client.commandExecute("/help");
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("command.execute");

    client.disconnect();

    await expect(
      Promise.race([
        pending,
        delay(100).then(() => {
          throw new Error("expected pending request to reject on disconnect");
        }),
      ]),
    ).rejects.toThrow(/disconnected/i);
  });
}

export function registerControlPlaneTests(fixture: ControlPlaneFixture): void {
  registerControlPlaneWorkflowTests(fixture);
  registerControlPlaneErrorTests(fixture);
}
