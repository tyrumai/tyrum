import { expect, it } from "vitest";
import type { WorkItem } from "@tyrum/contracts";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { broadcastWorkItemCreated } from "../../src/modules/workboard/item-broadcast.js";
import { createMockWs } from "./ws-workboard.test-support.js";

function makeItem(): WorkItem {
  return {
    work_item_id: "00000000-0000-4000-8000-000000000401",
    tenant_id: DEFAULT_TENANT_ID,
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
    kind: "action",
    title: "Broadcast item",
    status: "backlog",
    priority: 0,
    created_at: "2026-03-20T00:00:00.000Z",
    created_from_conversation_key: "agent:default:test:default:channel:thread-item-broadcast",
    last_active_at: null,
    updated_at: "2026-03-20T00:00:00.000Z",
  };
}

it("no-ops when work item created broadcasts have no deps", () => {
  expect(() => broadcastWorkItemCreated({ item: makeItem() })).not.toThrow();
});

it("broadcasts work item created events to connected client peers", () => {
  const connectionManager = new ConnectionManager();
  const ws = createMockWs();
  connectionManager.addClient(
    ws as never,
    [] as never,
    {
      authClaims: {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
      role: "client",
    } as never,
  );

  broadcastWorkItemCreated({
    item: makeItem(),
    deps: { connectionManager },
  });

  expect(ws.send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
    type: "work.item.created",
    payload: { item: { work_item_id: "00000000-0000-4000-8000-000000000401" } },
  });
});
