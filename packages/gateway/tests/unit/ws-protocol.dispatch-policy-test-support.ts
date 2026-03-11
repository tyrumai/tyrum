import { expect, it, vi } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  type ActionPrimitive,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask, handleClientMessage, NoCapableClientError } from "../../src/ws/protocol.js";
import { NoCapableNodeError, NodeNotPairedError } from "../../src/ws/protocol/errors.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createMockWs, makeDeps, makeClient } from "./ws-protocol.test-support.js";

const cliDescriptor = {
  id: descriptorIdForClientCapability("cli"),
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
} as const;

/**
 * Policy, allowlist, legacy client, and error tests for dispatchTask.
 * Must be called inside a `describe("dispatchTask")` block.
 */
function registerAllowlistTests(): void {
  it("dispatches to a paired node and prefers nodes over legacy clients", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: legacyWs } = makeClient(cm, [cliDescriptor]);

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: cliDescriptor.version,
              },
            ],
          }) as never,
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: cliDescriptor.id,
              version: cliDescriptor.version,
            },
          ],
        },
      }),
      deps,
    );
    nodeWs.send.mockClear();
    legacyWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(legacyWs.send).not.toHaveBeenCalled();
  });

  it("does not dispatch to a node when its pairing allowlist excludes the capability", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: clientWs } = makeClient(cm, [cliDescriptor], { protocolRev: 2 });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("http"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).not.toHaveBeenCalled();
  });

  it("does not dispatch to a node when its pairing allowlist version excludes the capability", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: clientWs } = makeClient(cm, [cliDescriptor], { protocolRev: 2 });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: "2.0.0",
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).not.toHaveBeenCalled();
  });
}

function registerPolicyEvaluationTests(): void {
  it("throws NodeDispatchDeniedError when policy denies node dispatch", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: cliDescriptor.version,
              },
            ],
          }) as never,
      } as never,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateToolCall: vi.fn(async () => {
          return {
            decision: "deny",
            policy_snapshot: { policy_snapshot_id: "snap-1" },
          };
        }),
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: cliDescriptor.id,
              version: cliDescriptor.version,
            },
          ],
        },
      }),
      deps,
    );
    nodeWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toMatchObject({ name: "NodeDispatchDeniedError" });
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("includes policy snapshot metadata in node dispatch trace", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: cliDescriptor.id,
                version: cliDescriptor.version,
              },
            ],
          }) as never,
      } as never,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateToolCall: vi.fn(async () => {
          return {
            decision: "allow",
            policy_snapshot: { policy_snapshot_id: "snap-1" },
          };
        }),
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: cliDescriptor.id,
              version: cliDescriptor.version,
            },
          ],
        },
      }),
      deps,
    );
    nodeWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();

    const sent = JSON.parse(nodeWs.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent["trace"]).toMatchObject({
      policy_snapshot_id: "snap-1",
      policy_decision: "allow",
    });
  });
}

function registerDispatchErrorTests(): void {
  it("does not dispatch tasks to legacy clients", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, [cliDescriptor] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: legacyWs } = makeClient(cm, [cliDescriptor]);

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(legacyWs.send).not.toHaveBeenCalled();
  });

  it("throws NoCapableNodeError when no node has the capability", () => {
    const cm = new ConnectionManager();
    makeClient(cm, [cliDescriptor]); // Only CLI capability
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: {},
    };

    expect(() =>
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableNodeError);
  });

  it("throws NoCapableNodeError when no nodes are connected", () => {
    const cm = new ConnectionManager();
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Http",
      args: {},
    };

    expect(() =>
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableNodeError);
  });

  it("throws NoCapableClientError for unmapped action type", () => {
    const cm = new ConnectionManager();
    makeClient(cm, []);
    const deps = makeDeps(cm);

    // "Research" has no capability mapping
    const action: ActionPrimitive = {
      type: "Research",
      args: {},
    };

    expect(() =>
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableClientError);
  });
}

export function registerDispatchPolicyTests(): void {
  registerAllowlistTests();
  registerPolicyEvaluationTests();
  registerDispatchErrorTests();
}
