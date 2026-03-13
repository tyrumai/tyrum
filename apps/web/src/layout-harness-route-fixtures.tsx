import {
  createElevatedModeStore,
  type OperatorCore,
} from "../../../packages/operator-core/src/index.js";
import type { DesktopApi } from "../../../packages/operator-ui/src/desktop-api.js";
import {
  createActivityStore,
  createAgentStatusStore,
  createApprovalsStore,
  createChatStore,
  createConnectionStore,
  createEventWsStub,
  createManagedAgentDetail,
  createPairingStore,
  createRunsStore,
  createStatusStore,
  createWorkboardStore,
} from "./layout-harness-store-fixtures.js";
import { createHarnessAgentHttpFixtures } from "./layout-harness-agent-http-fixtures.js";
import { createHarnessConfigureHttpFixtures } from "./layout-harness-configure-http-fixtures.js";

function createNodeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "embedded",
    embedded: { port: 8788 },
    permissions: { profile: "balanced", overrides: {} },
    capabilities: { desktop: true, playwright: true, cli: true, http: true },
    cli: { allowedCommands: [], allowedWorkingDirs: [] },
    web: { allowedDomains: [], headless: true },
    ...overrides,
  };
}

export function createDesktopApi(): DesktopApi {
  const config = createNodeConfig();
  return {
    getConfig: async () => config,
    setConfig: async () => {},
    gateway: {
      getStatus: async () => ({ status: "running", port: 8788 }),
      start: async () => ({ status: "running", port: 8788 }),
      stop: async () => ({ status: "stopped" }),
      getOperatorConnection: async () => ({
        mode: "embedded",
        wsUrl: "ws://127.0.0.1:8788/ws",
        httpBaseUrl: "http://127.0.0.1:8788/",
        token: "tyrum-token.v1.embedded.token",
        tlsCertFingerprint256: "",
        tlsAllowSelfSigned: false,
      }),
    },
    node: {
      connect: async () => ({ status: "connected" }),
      disconnect: async () => ({ status: "disconnected" }),
    },
    onStatusChange: () => () => {},
  } satisfies DesktopApi;
}

export function createAgentsCore(): OperatorCore {
  return {
    httpBaseUrl: "http://127.0.0.1:8788/",
    elevatedModeStore: createElevatedModeStore(),
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    agentStatusStore: createAgentStatusStore(),
    runsStore: createRunsStore(),
    http: createHarnessAgentHttpFixtures(createManagedAgentDetail),
  } as unknown as OperatorCore;
}

export function createDashboardCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    approvalsStore: createApprovalsStore(),
    pairingStore: createPairingStore(),
    runsStore: createRunsStore(),
    workboardStore: createWorkboardStore(),
    activityStore: createActivityStore(),
    http: {
      nodes: {
        list: async () => ({
          status: "ok",
          generated_at: "2026-03-08T00:00:00.000Z",
          nodes: [],
        }),
      },
    },
  } as unknown as OperatorCore;
}

export function createChatCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    approvalsStore: createApprovalsStore(),
    chatStore: createChatStore(),
  } as unknown as OperatorCore;
}

export function createApprovalsCore(): OperatorCore {
  return {
    approvalsStore: createApprovalsStore(),
    pairingStore: createPairingStore(),
    runsStore: createRunsStore(),
  } as unknown as OperatorCore;
}

export function createPairingCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    chatStore: createChatStore(),
    pairingStore: createPairingStore(),
    http: {
      nodes: {
        list: async () => ({
          status: "ok",
          generated_at: "2026-03-08T00:00:00.000Z",
          nodes: [],
        }),
      },
    },
  } as unknown as OperatorCore;
}

export function createWorkboardCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    workboardStore: createWorkboardStore(),
    ws: {
      ...createEventWsStub(),
    },
    connect() {},
    disconnect() {},
  } as unknown as OperatorCore;
}

export function createConfigureCore(): OperatorCore {
  return {
    elevatedModeStore: createElevatedModeStore(),
    http: createHarnessConfigureHttpFixtures(),
  } as unknown as OperatorCore;
}
