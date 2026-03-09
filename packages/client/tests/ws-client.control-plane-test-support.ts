import { expect, it } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
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

function registerControlPlaneSessionTests(fixture: ControlPlaneFixture): void {
  it("sends typed control-plane requests for session/workflow/pairing/presence", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const pingP = client.ping();
    const pingReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(pingReq["type"]).toBe("ping");
    expect(pingReq["payload"]).toEqual({});
    ws.send(
      JSON.stringify({
        request_id: pingReq["request_id"],
        type: "ping",
        ok: true,
      }),
    );
    await expect(pingP).resolves.toBeUndefined();

    const sendP = client.sessionSend({
      channel: "telegram",
      thread_id: "thread-1",
      content: "hello world",
    });
    const sendReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(sendReq["type"]).toBe("session.send");
    ws.send(
      JSON.stringify({
        request_id: sendReq["request_id"],
        type: "session.send",
        ok: true,
        result: { session_id: "session-1", assistant_message: "ok" },
      }),
    );
    await expect(sendP).resolves.toEqual({ session_id: "session-1", assistant_message: "ok" });

    const createP = client.sessionCreate({});
    const createReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(createReq["type"]).toBe("session.create");
    ws.send(
      JSON.stringify({
        request_id: createReq["request_id"],
        type: "session.create",
        ok: true,
        result: {
          session_id: "ui:ui-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "ui-1",
          title: "",
        },
      }),
    );
    await expect(createP).resolves.toEqual({
      session_id: "ui:ui-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-1",
      title: "",
    });

    const listP = client.sessionList({});
    const listReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(listReq["type"]).toBe("session.list");
    ws.send(
      JSON.stringify({
        request_id: listReq["request_id"],
        type: "session.list",
        ok: true,
        result: { sessions: [], next_cursor: null },
      }),
    );
    await expect(listP).resolves.toEqual({ sessions: [], next_cursor: null });

    const getP = client.sessionGet({ session_id: "ui:ui-1" });
    const getReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(getReq["type"]).toBe("session.get");
    ws.send(
      JSON.stringify({
        request_id: getReq["request_id"],
        type: "session.get",
        ok: true,
        result: {
          session: {
            session_id: "ui:ui-1",
            agent_id: "default",
            channel: "ui",
            thread_id: "ui-1",
            title: "",
            summary: "",
            turns: [{ role: "user", content: "hi" }],
            created_at: "2026-02-21T12:00:00Z",
            updated_at: "2026-02-21T12:00:00Z",
          },
        },
      }),
    );
    await expect(getP).resolves.toMatchObject({ session: { session_id: "ui:ui-1" } });

    const compactP = client.sessionCompact({ session_id: "ui:ui-1" });
    const compactReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(compactReq["type"]).toBe("session.compact");
    ws.send(
      JSON.stringify({
        request_id: compactReq["request_id"],
        type: "session.compact",
        ok: true,
        result: { session_id: "ui:ui-1", dropped_messages: 2, kept_messages: 8 },
      }),
    );
    await expect(compactP).resolves.toEqual({
      session_id: "ui:ui-1",
      dropped_messages: 2,
      kept_messages: 8,
    });

    const deleteP = client.sessionDelete({ session_id: "ui:ui-1" });
    const deleteReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(deleteReq["type"]).toBe("session.delete");
    ws.send(
      JSON.stringify({
        request_id: deleteReq["request_id"],
        type: "session.delete",
        ok: true,
        result: { session_id: "ui:ui-1" },
      }),
    );
    await expect(deleteP).resolves.toEqual({ session_id: "ui:ui-1" });
  });
}

function registerControlPlaneWorkflowTests(fixture: ControlPlaneFixture): void {
  it("sends typed workflow/pairing/presence/capability requests", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });
    fixture.setClient(client);

    const approvedPairing = {
      pairing: {
        pairing_id: 11,
        status: "approved",
        trust_level: "remote",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: ["http"],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [
          {
            id: descriptorIdForClientCapability("http"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
        resolution: {
          decision: "approved",
          resolved_at: "2026-02-21T12:00:10Z",
          reason: "looks good",
        },
        resolved_at: "2026-02-21T12:00:10Z",
      },
    };

    const deniedPairing = {
      pairing: {
        pairing_id: 11,
        status: "denied",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: ["http"],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [],
        resolution: {
          decision: "denied",
          resolved_at: "2026-02-21T12:00:11Z",
          reason: "not trusted",
        },
        resolved_at: "2026-02-21T12:00:11Z",
      },
    };

    const revokedPairing = {
      pairing: {
        pairing_id: 11,
        status: "revoked",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: ["http"],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [],
        resolution: {
          decision: "revoked",
          resolved_at: "2026-02-21T12:00:12Z",
          reason: "removed",
        },
        resolved_at: "2026-02-21T12:00:12Z",
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
          id: descriptorIdForClientCapability("http"),
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

    const readyP = client.capabilityReady({
      capabilities: [
        {
          id: descriptorIdForClientCapability("http"),
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

    const pending = client.sessionSend({
      channel: "telegram",
      thread_id: "thread-1",
      content: "hello",
    });
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("session.send");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "workflow.run",
        ok: true,
        result: {
          session_id: "session-1",
          assistant_message: "ok",
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
  registerControlPlaneSessionTests(fixture);
  registerControlPlaneWorkflowTests(fixture);
  registerControlPlaneErrorTests(fixture);
}
