import { vi } from "vitest";
import type {
  Approval,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  NodePairingRequest,
  PresenceEntry,
} from "@tyrum/schemas";
import type {
  PairingListResponse,
  PresenceResponse,
  StatusResponse,
  TyrumHttpClient,
  UsageResponse,
} from "@tyrum/client";
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
};

export type FakeHttpClient = Pick<
  TyrumHttpClient,
  "status" | "usage" | "presence" | "pairings" | "agentStatus"
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
  approvalResolve = vi.fn(async () => ({ approval: sampleApprovalApproved() }));
  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);
  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
  memoryGet = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }) as unknown);
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }) as unknown);
  sessionList = vi.fn(async () => ({ sessions: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    session: {
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-1",
      summary: "",
      turns: [],
      updated_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  }));
  sessionCreate = vi.fn(async () => ({
    session_id: "session-1",
    agent_id: "default",
    channel: "ui",
    thread_id: "ui-1",
  }));
  sessionCompact = vi.fn(async () => ({
    session_id: "session-1",
    dropped_messages: 0,
    kept_messages: 0,
  }));
  sessionDelete = vi.fn(async () => ({ session_id: "session-1" }));
  sessionSend = vi.fn(async () => ({ session_id: "session-1", assistant_message: "" }));
  workList = vi.fn(async () => ({ items: [] }) as unknown);

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
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: null,
    queue_depth: null,
    sandbox: null,
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

export function createFakeHttpClient(): FakeHttpClient {
  const calls: HttpCallCounts = {
    statusGet: 0,
    usageGet: 0,
    presenceList: 0,
    pairingsList: 0,
    agentStatusGet: 0,
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
  };
}

export function sampleApprovalPending(): Approval {
  return {
    approval_id: 1,
    kind: "other",
    status: "pending",
    prompt: "Approve?",
    created_at: "2026-01-01T00:00:00.000Z",
    resolution: null,
  };
}

export function sampleApprovalApproved(): Approval {
  return {
    approval_id: 1,
    kind: "other",
    status: "approved",
    prompt: "Approve?",
    created_at: "2026-01-01T00:00:00.000Z",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
  };
}

export function samplePairingPending(): NodePairingRequest {
  return {
    pairing_id: 10,
    status: "pending",
    requested_at: "2026-01-01T00:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "test-node",
      capabilities: [],
      last_seen_at: "2026-01-01T00:00:00.000Z",
    },
    capability_allowlist: [],
    resolution: null,
    resolved_at: null,
  };
}

export function samplePairingApproved(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "approved",
    trust_level: "local",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  };
}

export function samplePairingDenied(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "denied",
    resolution: {
      decision: "denied",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  };
}

export function samplePairingRevoked(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "revoked",
    resolution: {
      decision: "revoked",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
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
