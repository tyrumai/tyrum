import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { type ClientSpec, createBroadcastScenario } from "./outbox-poller.test-support.js";

function createAuthAuditMessage({
  includeEventId = true,
  includeScope = false,
  type,
}: {
  includeEventId?: boolean;
  includeScope?: boolean;
  type: "auth.failed" | "authz.denied";
}) {
  return {
    ...(includeEventId ? { event_id: "evt-1" } : {}),
    type,
    occurred_at: new Date().toISOString(),
    ...(includeScope ? { scope: { kind: "global" } } : {}),
    payload: { surface: type === "authz.denied" ? "http" : "ws.upgrade" },
  };
}

function createRoutingConfigMessage() {
  return {
    event_id: "evt-routing-1",
    type: "routing.config.updated",
    occurred_at: new Date().toISOString(),
    scope: { kind: "global" },
    payload: { revision: 1, config: { v: 1 } },
  };
}

function operatorClient(key = "operator"): ClientSpec {
  return {
    key,
    options: {
      authClaims: {
        token_kind: "device",
        token_id: "token-operator-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_operator_1",
        scopes: ["operator.read"],
      },
    },
  };
}

function plainClient(key = "other"): ClientSpec {
  return {
    key,
    options: {
      authClaims: {
        token_kind: "device",
        token_id: "token-client-2",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_2",
        scopes: [],
      },
    },
  };
}

function badScopesClient(key = "bad"): ClientSpec {
  return {
    key,
    options: {
      authClaims: {
        token_kind: "device",
        token_id: "token-bad-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_bad_1",
        scopes: [123],
      } as never,
    },
  };
}

function adminClient({
  id,
  key,
  scopes = ["*"],
  tokenId,
}: {
  id?: string;
  key: string;
  scopes?: string[];
  tokenId: string;
}): ClientSpec {
  return {
    key,
    options: {
      ...(id ? { id } : {}),
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: tokenId,
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes,
      },
    },
  };
}

function adminNode(key = "admin"): ClientSpec {
  return {
    key,
    options: {
      role: "node",
      authClaims: {
        token_kind: "admin",
        token_id: "token-admin-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    },
  };
}

function audienceMatrixClients(): readonly ClientSpec[] {
  return [
    {
      key: "admin",
      options: {
        id: "client-admin",
        role: "client",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-admin",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          scopes: ["operator.admin"],
        },
      },
    },
    {
      key: "readonly",
      options: {
        id: "client-readonly",
        role: "client",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-readonly",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          scopes: ["operator.read"],
        },
      },
    },
    {
      key: "node",
      options: {
        id: "node-1",
        role: "node",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-node-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "node",
          scopes: ["*"],
        },
      },
    },
  ];
}

export const authAuditCases = [
  {
    name: "broadcasts auth audit events only to operator-scoped clients",
    createScenario: () =>
      createBroadcastScenario({
        clients: [operatorClient(), plainClient()],
        payload: {
          message: createAuthAuditMessage({
            type: "auth.failed",
            includeScope: true,
          }),
        },
      }),
    expectedSent: ["operator"],
    expectedSilent: ["other"],
  },
  {
    name: "gates auth audit broadcasts even when event_id is missing",
    createScenario: () =>
      createBroadcastScenario({
        clients: [operatorClient(), plainClient()],
        payload: {
          message: createAuthAuditMessage({
            type: "auth.failed",
            includeEventId: false,
          }),
        },
      }),
    expectedSent: ["operator"],
    expectedSilent: ["other"],
  },
  {
    name: "does not crash when auth claims include non-string scopes",
    createScenario: () =>
      createBroadcastScenario({
        clients: [operatorClient(), badScopesClient()],
        payload: {
          message: createAuthAuditMessage({ type: "auth.failed" }),
        },
      }),
    expectedSent: ["operator"],
    expectedSilent: ["bad"],
  },
  {
    name: "delivers auth audit events to admin-token clients even without wildcard scopes",
    createScenario: () =>
      createBroadcastScenario({
        clients: [
          adminClient({ key: "admin", tokenId: "token-admin-1", scopes: [] }),
          plainClient(),
        ],
        payload: {
          message: createAuthAuditMessage({ type: "authz.denied" }),
        },
      }),
    expectedSent: ["admin"],
    expectedSilent: ["other"],
  },
  {
    name: "does not deliver auth audit events to admin-token nodes",
    createScenario: () =>
      createBroadcastScenario({
        clients: [adminNode()],
        payload: {
          message: createAuthAuditMessage({ type: "auth.failed" }),
        },
      }),
    expectedSent: [],
    expectedSilent: ["admin"],
  },
] as const;

export const audienceCases = [
  {
    name: "filters ws.broadcast delivery using audience constraints",
    createScenario: () =>
      createBroadcastScenario({
        clients: audienceMatrixClients(),
        payload: {
          message: createRoutingConfigMessage(),
          audience: {
            roles: ["client"],
            required_scopes: ["operator.admin"],
          },
        },
      }),
    expectedSendCounts: { admin: 1, readonly: 0, node: 0 },
  },
  {
    name: "treats empty ws.broadcast audience as no constraints",
    createScenario: () =>
      createBroadcastScenario({
        clients: audienceMatrixClients(),
        payload: {
          message: createRoutingConfigMessage(),
          audience: {
            roles: [],
            required_scopes: [],
          },
        },
      }),
    expectedSendCounts: { admin: 1, readonly: 1, node: 1 },
  },
  {
    name: "fails closed when ws.broadcast audience is malformed",
    createScenario: () =>
      createBroadcastScenario({
        clients: audienceMatrixClients(),
        payload: {
          message: createRoutingConfigMessage(),
          audience: {
            roles: ["client", "bogus"],
          },
        },
      }),
    expectedSendCounts: { admin: 0, readonly: 0, node: 0 },
  },
] as const;
