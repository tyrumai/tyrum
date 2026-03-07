import { Hono } from "hono";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import {
  TelegramChannelProcessor,
  TelegramChannelQueue,
} from "../../src/modules/channels/telegram.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const TELEGRAM_QUEUE_ENV_KEYS = [
  "TELEGRAM_WEBHOOK_SECRET",
  "TYRUM_POLICY_BUNDLE_PATH",
  "TYRUM_TELEGRAM_CHANNEL_KEY",
  "TYRUM_TELEGRAM_ACCOUNT_ID",
  "TYRUM_CHANNEL_TYPING_MODE",
  "TYRUM_CHANNEL_TYPING_REFRESH_MS",
  "TYRUM_CHANNEL_TYPING_AUTOMATION_ENABLED",
] as const;

type TelegramQueueEnvKey = (typeof TELEGRAM_QUEUE_ENV_KEYS)[number];
type TelegramQueueEnvSnapshot = Record<TelegramQueueEnvKey, string | undefined>;
type TelegramUpdateOptions = {
  messageId?: number;
  chatType?: "private" | "group" | "supergroup" | "channel";
  senderId?: number;
};
type TelegramQueueOptions = Omit<
  NonNullable<ConstructorParameters<typeof TelegramChannelQueue>[1]>,
  "sessionDal"
>;
type TelegramProcessorOptions = Omit<
  Partial<ConstructorParameters<typeof TelegramChannelProcessor>[0]>,
  "agents" | "db" | "sessionDal" | "telegramBot"
>;

export type TelegramQueueTestState = {
  db: SqliteDb | undefined;
};

export type ApprovalPolicyFixture = {
  bundlePath: string;
  tempDir: string;
};

export const TEST_TELEGRAM_WEBHOOK_SECRET = "test-telegram-secret";

function makeTurnResult(reply: string) {
  return {
    reply,
    session_id: "session-abc",
    used_tools: [],
    memory_written: false,
  };
}

export function captureTelegramQueueEnv(): TelegramQueueEnvSnapshot {
  return Object.fromEntries(
    TELEGRAM_QUEUE_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as TelegramQueueEnvSnapshot;
}

export function restoreTelegramQueueEnv(snapshot: TelegramQueueEnvSnapshot): void {
  for (const key of TELEGRAM_QUEUE_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export function resetTelegramQueueEnv(): void {
  process.env["TELEGRAM_WEBHOOK_SECRET"] = TEST_TELEGRAM_WEBHOOK_SECRET;
  delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
  delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
  delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
  delete process.env["TYRUM_CHANNEL_TYPING_MODE"];
  delete process.env["TYRUM_CHANNEL_TYPING_REFRESH_MS"];
  delete process.env["TYRUM_CHANNEL_TYPING_AUTOMATION_ENABLED"];
}

export function openTelegramQueueTestDb(state: TelegramQueueTestState): SqliteDb {
  const db = openTestSqliteDb();
  state.db = db;
  return db;
}

export function makeSessionDal(db: SqliteDb): SessionDal {
  return new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
}

export function makeTelegramUpdate(
  text: string,
  chatId = 123,
  opts?: TelegramUpdateOptions | number,
) {
  const resolvedOptions = typeof opts === "object" ? opts : undefined;

  return {
    update_id: 100,
    message: {
      message_id: resolvedOptions?.messageId ?? 42,
      date: 1700000000,
      from: { id: resolvedOptions?.senderId ?? 999, is_bot: false, first_name: "Alice" },
      chat: { id: chatId, type: resolvedOptions?.chatType ?? "private" },
      text,
    },
  };
}

export function mockFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{"ok":true}'),
    json: () => Promise.resolve({ ok: true }),
  }) as unknown as typeof fetch;
}

export function makeAgents(runtime: unknown, policyService?: PolicyService): AgentRegistry {
  return {
    getRuntime: async () => runtime,
    getPolicyService: () =>
      policyService ?? ({ isEnabled: () => false } as unknown as PolicyService),
  } as AgentRegistry;
}

export function makeResolvedRuntime(reply = "I can help with that!") {
  return {
    turn: vi.fn().mockResolvedValue(makeTurnResult(reply)),
  };
}

export function makeDelayedRuntime(delayMs = 2_500, reply = "I can help with that!") {
  return {
    turn: vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return makeTurnResult(reply);
    }),
  };
}

export function makeRejectedRuntime(message = "boom") {
  return {
    turn: vi.fn().mockRejectedValue(new Error(message)),
  };
}

export function createIngressApp({
  agents,
  bot,
  queue,
  runtime,
}: {
  agents?: AgentRegistry;
  bot: TelegramBot;
  queue: TelegramChannelQueue;
  runtime?: unknown;
}): Hono {
  const app = new Hono();

  app.route(
    "/",
    createIngressRoutes({
      telegramBot: bot,
      telegramWebhookSecret: TEST_TELEGRAM_WEBHOOK_SECRET,
      agents: agents ?? makeAgents(runtime ?? {}),
      telegramQueue: queue,
    }),
  );

  return app;
}

export async function postTelegramUpdate(
  app: Hono,
  update: unknown,
  query = "",
): Promise<Response> {
  return await app.request(`/ingress/telegram${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": TEST_TELEGRAM_WEBHOOK_SECRET,
    },
    body: JSON.stringify(update),
  });
}

export function listTypingCalls(fetchFn: typeof fetch) {
  return (fetchFn as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
    String(url).endsWith("/sendChatAction"),
  );
}

export async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

export async function withApprovalPolicyBundle<T>(
  run: (fixture: ApprovalPolicyFixture) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "tyrum-policy-"));

  try {
    const bundlePath = join(tempDir, "policy.yml");
    await writeFile(
      bundlePath,
      [
        "v: 1",
        "connectors:",
        "  default: require_approval",
        "  allow: []",
        "  require_approval:",
        '    - "telegram:*"',
        "  deny: []",
        "",
      ].join("\n"),
      "utf-8",
    );
    process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;

    return await run({ tempDir, bundlePath });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function createApprovalTestApp(
  approvalDal: ApprovalDal,
  policyOverrideDal: PolicyOverrideDal,
): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "test-token",
      tenant_id: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route("/", createApprovalRoutes({ approvalDal, policyOverrideDal }));

  return app;
}

export function setupTelegramProcessorHarness(
  state: TelegramQueueTestState,
  options?: {
    agents?: AgentRegistry;
    processorOptions?: TelegramProcessorOptions;
    queueOptions?: TelegramQueueOptions;
    runtime?: unknown;
  },
) {
  const db = openTelegramQueueTestDb(state);
  const sessionDal = makeSessionDal(db);
  const fetchFn = mockFetch();
  const bot = new TelegramBot("test-token", fetchFn);
  const runtime = options?.runtime ?? makeResolvedRuntime();
  const queue = new TelegramChannelQueue(db, {
    sessionDal,
    ...options?.queueOptions,
  });
  const processor = new TelegramChannelProcessor({
    db,
    sessionDal,
    agents: options?.agents ?? makeAgents(runtime),
    telegramBot: bot,
    owner: "test-owner",
    debounceMs: 0,
    maxBatch: 1,
    ...options?.processorOptions,
  });

  return {
    bot,
    db,
    fetchFn,
    processor,
    queue,
    runtime,
    sessionDal,
  };
}
