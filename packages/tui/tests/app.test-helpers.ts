import { PassThrough } from "node:stream";
import { vi } from "vitest";

export function createTestStreams(): {
  stdout: PassThrough & { columns: number; rows: number };
  stdin: PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
    ref: () => void;
    unref: () => void;
    resume: () => PassThrough;
  };
  readOutput: () => string;
} {
  const stdout = new PassThrough() as PassThrough & {
    columns: number;
    rows: number;
    isTTY: boolean;
  };
  stdout.columns = 80;
  stdout.rows = 24;
  stdout.isTTY = true;
  let output = "";
  stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    output += text;
  });

  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
    ref: () => void;
    unref: () => void;
    resume: () => PassThrough;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => stdin;

  return {
    stdout,
    stdin,
    readOutput: () => output,
  };
}

export function createStore<T>(snapshot: T): {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
} {
  return { getSnapshot: () => snapshot, subscribe: () => () => {} };
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const ANSI_ESCAPE_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function normalizeTuiOutput(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

export async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 2_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition");
}

export const DEFAULT_CONFIG = {
  httpBaseUrl: "http://127.0.0.1:8788",
  wsUrl: "ws://127.0.0.1:8788/ws",
  token: "token",
  deviceIdentityPath: "/tmp/device-identity.json",
  reconnect: false,
  tlsCertFingerprint256: undefined,
  tlsAllowSelfSigned: false,
} as const;

export function createEmptyApprovalsStore(
  overrides: Partial<{ pendingIds: string[]; byId: Record<string, unknown> }> = {},
) {
  return {
    ...createStore({
      pendingIds: [],
      byId: {},
      loading: false,
      error: null,
      ...overrides,
    }),
    refreshPending: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
  };
}

export function createPairingStore(
  overrides: Partial<{
    byId: Record<number, unknown>;
    pendingIds: number[];
    loading: boolean;
    error: unknown;
    lastSyncedAt: string | null;
  }> = {},
) {
  return {
    ...createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
      ...overrides,
    }),
    refresh: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    deny: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
  };
}

export function createStatusStore() {
  return createStore({
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
}

export function createTurnsStore() {
  return createStore({
    turnsById: {},
    turnItemIdsByTurnId: {},
    turnItemsById: {},
  });
}

export function createElevatedModeStore(
  status: "active" | "inactive",
  overrides: Partial<{
    elevatedToken: string | null;
    enteredAt: string | null;
    expiresAt: string | null;
    remainingMs: number | null;
  }> = {},
) {
  return createStore({
    status,
    elevatedToken: status === "active" ? "elevated" : null,
    enteredAt: status === "active" ? "2026-02-26T00:00:00.000Z" : null,
    expiresAt: status === "active" ? "2026-02-26T00:10:00.000Z" : null,
    remainingMs: status === "active" ? 60_000 : null,
    ...overrides,
  });
}

export function createConnectionStore(
  status: "connected" | "disconnected",
  overrides: Partial<{
    clientId: string;
    transportError: string | null;
    lastDisconnect: { code: number; reason: string } | null;
  }> = {},
) {
  return createStore({
    status,
    clientId: "client-1",
    transportError: status === "disconnected" ? "network down" : null,
    lastDisconnect: status === "disconnected" ? { code: 1006, reason: "closed" } : null,
    ...overrides,
  });
}

export function createCore({
  connect,
  disconnect,
  elevatedModeStore,
  connectionStore,
  approvalsStore = createEmptyApprovalsStore(),
  pairingStore = createPairingStore(),
}: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  elevatedModeStore: ReturnType<typeof createStore>;
  connectionStore: ReturnType<typeof createStore>;
  approvalsStore?: ReturnType<typeof createEmptyApprovalsStore>;
  pairingStore?: ReturnType<typeof createPairingStore>;
}) {
  return {
    connect,
    disconnect,
    elevatedModeStore,
    connectionStore,
    approvalsStore,
    pairingStore,
    statusStore: createStatusStore(),
    turnsStore: createTurnsStore(),
  };
}

export function createRuntime(core: unknown): {
  manager: { getCore: () => unknown; subscribe: () => () => void; dispose: () => void };
  enterElevatedMode: (token: string) => Promise<void>;
  exitElevatedMode: () => void;
  dispose: () => void;
} {
  const manager = { getCore: () => core, subscribe: () => () => {}, dispose: () => {} };
  return {
    manager,
    enterElevatedMode: vi.fn(async () => {}),
    exitElevatedMode: vi.fn(() => {}),
    dispose: vi.fn(() => {}),
  };
}
