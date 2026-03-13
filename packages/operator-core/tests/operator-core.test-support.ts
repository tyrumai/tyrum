import { vi } from "vitest";
import type {
  Approval,
  DesktopEnvironment,
  DesktopEnvironmentHost,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  NodePairingRequest,
  PresenceEntry,
  ReviewEntry,
} from "@tyrum/schemas";
import type {
  PairingListResponse,
  PresenceResponse,
  StatusResponse,
  TyrumHttpClient,
  UsageResponse,
} from "@tyrum/client";
import {
  WsChatSessionCreateResult,
  WsChatSessionDeleteResult,
  WsChatSessionGetResult,
} from "@tyrum/schemas";
import { createBearerTokenAuth, createOperatorCore } from "../src/index.js";

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
};

export type FakeHttpClient = Pick<
  TyrumHttpClient,
  | "status"
  | "usage"
  | "presence"
  | "pairings"
  | "agentStatus"
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
  runList = vi.fn(async () => ({ runs: [], steps: [], attempts: [] }));
  approvalResolve = vi.fn(async () => ({ approval: sampleApprovalApproved() }));
  sessionList = vi.fn(async () => ({ sessions: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    session: WsChatSessionGetResult.parse({
      session: {
        session_id: "session-1",
        agent_id: "default",
        channel: "ui",
        thread_id: "ui-1",
        title: "",
        message_count: 0,
        last_message: null,
        messages: [],
        updated_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    }).session,
  }));
  sessionCreate = vi.fn(
    async () =>
      WsChatSessionCreateResult.parse({
        session: {
          session_id: "session-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "ui-1",
          title: "",
          message_count: 0,
          last_message: null,
          messages: [],
          updated_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }).session,
  );
  sessionDelete = vi.fn(async () => WsChatSessionDeleteResult.parse({ session_id: "session-1" }));
  workList = vi.fn(async () => ({ items: [] }) as unknown);
  requestDynamic = vi.fn(
    async (type: string, payload: unknown, schema?: { parse?: (input: unknown) => unknown }) => {
      let result: unknown;
      switch (type) {
        case "chat.session.list":
          result = await this.sessionList(payload);
          break;
        case "chat.session.get":
          result = await this.sessionGet(payload);
          break;
        case "chat.session.create":
          result = await this.sessionCreate(payload);
          break;
        case "chat.session.delete":
          result = await this.sessionDelete(payload);
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

export function sampleStatusResponse(): StatusResponse {
  return {
    status: "ok",
    version: "0.1.0",
    instance_id: "gateway-1",
    role: "gateway",
    db_kind: "sqlite",
    is_exposed: false,
    otel_enabled: false,
    auth: { enabled: true },
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: null,
    queue_depth: null,
    sandbox: null,
    config_health: { status: "ok", issues: [] },
  };
}

export function sampleUsageResponse(): UsageResponse {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    scope: { kind: "deployment", run_id: null, key: null, agent_id: null },
    local: {
      attempts: { total_with_cost: 0, parsed: 0, invalid: 0 },
      totals: { duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd_micros: 0 },
    },
    provider: null,
  };
}

export function samplePresenceResponse(): PresenceResponse {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    entries: [],
  };
}

export function samplePairingListResponse(): PairingListResponse {
  return { status: "ok", pairings: [] };
}

export function sampleDesktopEnvironmentHost(): DesktopEnvironmentHost {
  return {
    host_id: "host-1",
    label: "Primary runtime",
    version: "0.1.0",
    docker_available: true,
    healthy: true,
    last_seen_at: "2026-01-01T00:00:00.000Z",
    last_error: null,
  };
}

export function sampleDesktopEnvironment(): DesktopEnvironment {
  return {
    environment_id: "env-1",
    host_id: "host-1",
    label: "Research desktop",
    image_ref: "registry.example.test/desktop@sha256:1234",
    managed_kind: "docker",
    status: "running",
    desired_running: true,
    node_id: "node-desktop-1",
    takeover_url: "http://127.0.0.1:8788/desktop-environments/env-1/takeover",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    last_error: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function sampleReview(
  input: Partial<ReviewEntry> &
    Pick<ReviewEntry, "review_id" | "target_type" | "target_id" | "reviewer_kind" | "state">,
): ReviewEntry {
  return {
    reviewer_id: null,
    reason: null,
    risk_level: null,
    risk_score: null,
    evidence: null,
    decision_payload: null,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    ...input,
  };
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
    desktopEnvironments: {
      list: vi.fn(async () => {
        calls.desktopEnvironmentsList++;
        return { status: "ok", environments: [sampleDesktopEnvironment()] } as const;
      }),
      get: vi.fn(async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const),
      create: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
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
    },
  };
}

export function sampleApprovalPending(): Approval {
  return {
    approval_id: "11111111-1111-1111-1111-111111111111",
    approval_key: "approval:11111111-1111-1111-1111-111111111111",
    kind: "policy",
    status: "awaiting_human",
    prompt: "Approve?",
    motivation: "Approval is required before execution can continue.",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    latest_review: sampleReview({
      review_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      target_type: "approval",
      target_id: "11111111-1111-1111-1111-111111111111",
      reviewer_kind: "human",
      state: "requested_human",
    }),
  };
}

export function sampleApprovalApproved(): Approval {
  return {
    ...sampleApprovalPending(),
    status: "approved",
    latest_review: sampleReview({
      review_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      target_type: "approval",
      target_id: "11111111-1111-1111-1111-111111111111",
      reviewer_kind: "human",
      state: "approved",
      reason: "approved",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePairingPending(): NodePairingRequest {
  return {
    pairing_id: 10,
    status: "awaiting_human",
    motivation: "A new node wants to connect.",
    trust_level: "local",
    requested_at: "2026-01-01T00:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "test-node",
      capabilities: [],
      last_seen_at: "2026-01-01T00:00:00.000Z",
    },
    capability_allowlist: [],
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "requested_human",
    }),
  };
}

export function samplePairingApproved(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "approved",
    trust_level: "local",
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "approved",
      reason: "approved",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePairingDenied(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "denied",
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "denied",
      reason: "denied",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePairingRevoked(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "revoked",
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "revoked",
      reason: "revoked",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePresenceEntry(): PresenceEntry {
  return {
    instance_id: "client-1",
    role: "client",
    last_seen_at: "2026-01-01T00:00:00.000Z",
  };
}

export function sampleRun(): ExecutionRun {
  return {
    run_id: "run-1",
    job_id: "job-1",
    key: "t:test",
    lane: "default",
    status: "running",
    attempt: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:01.000Z",
    finished_at: null,
  };
}

export function sampleStep(): ExecutionStep {
  return {
    step_id: "step-1",
    run_id: "run-1",
    step_index: 0,
    status: "running",
    action: { type: "Research", args: {} },
    created_at: "2026-01-01T00:00:02.000Z",
  };
}

export function sampleAttempt(): ExecutionAttempt {
  return {
    attempt_id: "attempt-1",
    step_id: "step-1",
    attempt: 1,
    status: "running",
    started_at: "2026-01-01T00:00:03.000Z",
    finished_at: null,
    error: null,
    artifacts: [],
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
