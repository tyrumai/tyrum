import { expect, it } from "vitest";
import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  acceptConnect,
  createTestServer,
  delay,
  waitForMessage,
} from "./ws-client.test-support.js";

type ControlPlaneFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

export function registerControlPlaneSessionTests(fixture: ControlPlaneFixture): void {
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
            transcript: [
              {
                kind: "text",
                id: "turn-1",
                role: "user",
                content: "hi",
                created_at: "2026-02-21T12:00:00Z",
              },
            ],
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
