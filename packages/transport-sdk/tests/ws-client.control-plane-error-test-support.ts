import { expect, it } from "vitest";
import { waitForMessage } from "./ws-client.test-support.js";
import {
  connectControlPlaneClient,
  type ControlPlaneFixture,
  type ControlPlaneSocket,
} from "./ws-client.control-plane-shared.js";

async function waitForTypedRequest(
  ws: ControlPlaneSocket,
  expectedType: string,
): Promise<Record<string, unknown>> {
  const request = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(request["type"]).toBe(expectedType);
  return request;
}

export function registerControlPlaneErrorTests(fixture: ControlPlaneFixture): void {
  it("rejects void helper responses with non-empty ack payloads", async () => {
    const { client, ws } = await connectControlPlaneClient({ fixture });

    const pending = client.ping();
    const request = await waitForTypedRequest(ws, "ping");
    ws.send(
      JSON.stringify({
        request_id: request["request_id"],
        type: "ping",
        ok: true,
        result: { unexpected: true },
      }),
    );

    await expect(pending).rejects.toThrow(/returned invalid result/i);
  });

  it("rejects helper request when response type mismatches", async () => {
    const { client, ws } = await connectControlPlaneClient({ fixture });

    const pending = client.commandExecute("/help");
    const request = await waitForTypedRequest(ws, "command.execute");
    ws.send(
      JSON.stringify({
        request_id: request["request_id"],
        type: "workflow.start",
        ok: true,
        result: {
          job_id: "job-1",
        },
      }),
    );

    await expect(pending).rejects.toThrow(/mismatched response type/i);
  });

  it("rejects pending requests immediately on disconnect", async () => {
    const { client, ws } = await connectControlPlaneClient({ fixture });

    const pending = client.commandExecute("/help");
    await waitForTypedRequest(ws, "command.execute");

    client.disconnect();

    await expect(
      Promise.race([
        pending,
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error("expected pending request to reject on disconnect"));
          }, 100);
        }),
      ]),
    ).rejects.toThrow(/disconnected/i);
  });
}
