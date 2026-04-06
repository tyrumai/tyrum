import type { WsResponseErrEnvelope } from "@tyrum/contracts";
import type { PolicyService } from "@tyrum/runtime-policy";
import { describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";

function isErrorResponse(value: unknown): value is WsResponseErrEnvelope {
  return Boolean(value) && typeof value === "object" && "ok" in value && value.ok === false;
}

describe("workflow.start control-plane handler", () => {
  it.each([
    "agent:default:automation:default:group:heartbeat",
    "agent:default:automation:default:dm:heartbeat",
  ])("rejects non-canonical automation alias keys like %s over WS", async (conversationKey) => {
    const response = await handleClientMessage(
      createAdminWsClient(),
      serializeWsRequest({
        type: "workflow.start",
        payload: {
          conversation_key: conversationKey,
          steps: [{ type: "CLI" }],
        },
      }),
      {
        connectionManager: new ConnectionManager(),
        db: {} as SqlDb,
        policyService: {} as PolicyService,
      },
    );

    expect(isErrorResponse(response)).toBe(true);
    expect(response?.error.code).toBe("invalid_request");
  });
});
