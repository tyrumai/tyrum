import { vi } from "vitest";
import type { TyrumHttpClient } from "@tyrum/transport-sdk";
import {
  WsConversationCreateResult,
  WsConversationDeleteResult,
  WsConversationGetResult,
  WsTranscriptGetResult,
  WsTranscriptListResult,
} from "@tyrum/contracts";
import { createBearerTokenAuth, createOperatorCore } from "../src/index.js";
import {
  sampleApprovalApproved,
  sampleDesktopEnvironment,
  sampleDesktopEnvironmentHost,
  samplePairingApproved,
  samplePairingDenied,
  samplePairingListResponse,
  samplePairingRevoked,
  samplePresenceResponse,
  sampleStatusResponse,
  sampleUsageResponse,
} from "./operator-core.test-fixtures.js";

export {
  sampleApprovalApproved,
  sampleApprovalPending,
  sampleAttempt,
  sampleDesktopEnvironment,
  sampleDesktopEnvironmentHost,
  samplePairingListResponse,
  samplePairingPending,
  samplePresenceEntry,
  samplePresenceResponse,
  sampleRun,
  sampleStatusResponse,
  sampleStep,
  sampleUsageResponse,
} from "./operator-core.test-fixtures.js";

const TEST_WS_URL = "ws://127.0.0.1:8788/ws";
const TEST_HTTP_BASE_URL = "http://127.0.0.1:8788";
const TEST_AUTH_TOKEN = "test-token";

type Handler = (data: unknown) => void;

type HttpCallCounts = {
  statusGet: number;
  usageGet: number;
  presenceList: number;
  pairingsList: number;
  agentStatusGet: number;
  desktopEnvironmentHostsList: number;
  desktopEnvironmentsList: number;
  agentListGet: number;
};

export type FakeHttpClient = Pick<
  TyrumHttpClient,
  | "status"
  | "usage"
  | "presence"
  | "pairings"
  | "agentStatus"
  | "agentList"
  | "desktopEnvironmentHosts"
  | "desktopEnvironments"
> & {
  __calls: HttpCallCounts;
};

type CreateTestOperatorCoreOptions = {
  ws?: FakeWsClient;
  http?: FakeHttpClient;
  authToken?: string;
  elevatedModeStore?: Parameters<typeof createOperatorCore>[0]["elevatedModeStore"];
};

export class FakeWsClient {
  connected = false;
  private readonly handlers = new Map<string, Set<Handler>>();

  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});
  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  turnList = vi.fn(async () => ({ turns: [], steps: [], attempts: [] }));
  runList = this.turnList;
  approvalResolve = vi.fn(async () => ({ approval: sampleApprovalApproved() }));
  sessionList = vi.fn(async () => ({ conversations: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    conversation: WsConversationGetResult.parse({
      conversation: {
        conversation_id: "session-1",
        agent_key: "default",
        channel: "ui",
        thread_id: "ui-1",
        title: "",
        message_count: 0,
        queue_mode: "steer",
        last_message: null,
        messages: [],
        updated_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    }).conversation,
  }));
  sessionCreate = vi.fn(
    async () =>
      WsConversationCreateResult.parse({
        conversation: {
          conversation_id: "session-1",
          agent_key: "default",
          channel: "ui",
          thread_id: "ui-1",
          title: "",
          message_count: 0,
          queue_mode: "steer",
          last_message: null,
          messages: [],
          updated_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }).conversation,
  );
  sessionDelete = vi.fn(async () =>
    WsConversationDeleteResult.parse({ conversation_id: "session-1" }),
  );
  sessionQueueModeSet = vi.fn(async (payload: { queue_mode: string; conversation_id: string }) => ({
    conversation_id: payload.conversation_id,
    queue_mode: payload.queue_mode,
  }));
  transcriptList = vi.fn(async () =>
    WsTranscriptListResult.parse({ conversations: [], next_cursor: null }),
  );
  transcriptGet = vi.fn(async () =>
    WsTranscriptGetResult.parse({
      root_session_key: "session-1",
      focus_session_key: "session-1",
      conversations: [],
      events: [],
    }),
  );
  workList = vi.fn(
    async () =>
      ({
        scope: {
          tenant_id: "tenant-default",
          agent_id: "agent-default",
          workspace_id: "workspace-default",
        },
        items: [],
      }) as unknown,
  );
  requestDynamic = vi.fn(
    async (type: string, payload: unknown, schema?: { parse?: (input: unknown) => unknown }) => {
      let result: unknown;
      switch (type) {
        case "conversation.list":
          result = await this.sessionList(payload);
          break;
        case "conversation.get":
          result = await this.sessionGet(payload);
          break;
        case "conversation.create":
          result = await this.sessionCreate(payload);
          break;
        case "conversation.delete":
          result = await this.sessionDelete(payload);
          break;
        case "conversation.queue_mode.set":
          result = await this.sessionQueueModeSet(
            payload as { queue_mode: string; conversation_id: string },
          );
          break;
        case "transcript.list":
          result = await this.transcriptList(payload);
          break;
        case "transcript.get":
          result = await this.transcriptGet(payload);
          break;
        default:
          throw new Error(`unsupported dynamic request: ${type}`);
      }
      return schema?.parse ? schema.parse(result) : result;
    },
  );
  onDynamicEvent = vi.fn((event: string, handler: Handler) => this.on(event, handler));
  offDynamicEvent = vi.fn((event: string, handler: Handler) => this.off(event, handler));

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      return;
    }
    this.handlers.set(event, new Set([handler]));
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, data: unknown): void {
    if (event === "connected") {
      this.connected = true;
    }
    if (event === "disconnected") {
      this.connected = false;
    }
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

export function createFakeHttpClient(): FakeHttpClient {
  const calls: HttpCallCounts = {
    statusGet: 0,
    usageGet: 0,
    presenceList: 0,
    pairingsList: 0,
    agentStatusGet: 0,
    desktopEnvironmentHostsList: 0,
    desktopEnvironmentsList: 0,
    agentListGet: 0,
  };

  return {
    __calls: calls,
    status: {
      get: vi.fn(async () => {
        calls.statusGet++;
        return sampleStatusResponse();
      }),
    },
    usage: {
      get: vi.fn(async () => {
        calls.usageGet++;
        return sampleUsageResponse();
      }),
    },
    presence: {
      list: vi.fn(async () => {
        calls.presenceList++;
        return samplePresenceResponse();
      }),
    },
    pairings: {
      list: vi.fn(async () => {
        calls.pairingsList++;
        return samplePairingListResponse();
      }),
      approve: vi.fn(async () => ({ status: "ok", pairing: samplePairingApproved() })),
      deny: vi.fn(async () => ({ status: "ok", pairing: samplePairingDenied() })),
      revoke: vi.fn(async () => ({ status: "ok", pairing: samplePairingRevoked() })),
    },
    agentStatus: {
      get: vi.fn(async () => {
        calls.agentStatusGet++;
        return { status: "ok" } as unknown;
      }),
    },
    desktopEnvironmentHosts: {
      list: vi.fn(async () => {
        calls.desktopEnvironmentHostsList++;
        return { status: "ok", hosts: [sampleDesktopEnvironmentHost()] } as const;
      }),
    },
    agentList: {
      get: vi.fn(async () => {
        calls.agentListGet++;
        return { agents: [] };
      }),
    },
    desktopEnvironments: {
      list: vi.fn(async () => {
        calls.desktopEnvironmentsList++;
        return { status: "ok", environments: [sampleDesktopEnvironment()] } as const;
      }),
      getDefaults: vi.fn(
        async () =>
          ({
            status: "ok",
            default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
            revision: 1,
            created_at: "2026-03-10T12:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "token-1" },
            reason: null,
            reverted_from_revision: null,
          }) as const,
      ),
      get: vi.fn(async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const),
      create: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      updateDefaults: vi.fn(
        async (input: { default_image_ref: string; reason?: string }) =>
          ({
            status: "ok",
            default_image_ref: input.default_image_ref,
            revision: 2,
            created_at: "2026-03-10T12:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "token-1" },
            reason: input.reason ?? null,
            reverted_from_revision: null,
          }) as const,
      ),
      update: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      start: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      stop: vi.fn(
        async () =>
          ({
            status: "ok",
            environment: {
              ...sampleDesktopEnvironment(),
              status: "stopped",
              desired_running: false,
            },
          }) as const,
      ),
      reset: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      remove: vi.fn(async () => ({ status: "ok", deleted: true }) as const),
      logs: vi.fn(
        async () =>
          ({
            status: "ok",
            environment_id: "env-1",
            logs: ["booting runtime", "runtime ready"],
          }) as const,
      ),
      createTakeoverSession: vi.fn(
        async () =>
          ({
            status: "ok",
            session: {
              session_id: "session-1",
              entry_url:
                "http://127.0.0.1:8788/desktop-takeover/s/token-1/vnc.html?autoconnect=true",
              expires_at: "2026-03-10T12:30:00.000Z",
            },
          }) as const,
      ),
    },
  };
}

export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createTestOperatorCore(options: CreateTestOperatorCoreOptions = {}) {
  const ws = options.ws ?? new FakeWsClient();
  const http = options.http ?? createFakeHttpClient();
  const core = createOperatorCore({
    wsUrl: TEST_WS_URL,
    httpBaseUrl: TEST_HTTP_BASE_URL,
    auth: createBearerTokenAuth(options.authToken ?? TEST_AUTH_TOKEN),
    deps: { ws, http },
    elevatedModeStore: options.elevatedModeStore,
  });
  return { core, ws, http };
}
