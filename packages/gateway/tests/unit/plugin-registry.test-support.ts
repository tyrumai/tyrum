import { expect } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { Logger } from "../../src/modules/observability/logger.js";
import type { PluginRegistry } from "../../src/modules/plugins/registry.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";
import {
  pluginEntryModule,
  pluginIntegritySha256Hex,
  pluginManifestYaml,
  type PluginManifestOptions,
} from "./plugin-registry.fixtures.test-support.js";

export type CapturedLog = { msg: string; fields: Record<string, unknown> };

type FixtureFile = {
  base?: "home" | "plugin" | "pluginsRoot";
  relativePath: string;
  raw: string;
};

export type EchoPluginFixtureOptions = {
  pluginDirName?: string;
  manifest?: string;
  manifestOpts?: PluginManifestOptions;
  entry?: string | null;
  config?: {
    fileName: string;
    raw: string;
  };
  files?: FixtureFile[];
  lock?: {
    pinnedVersion: string;
    integritySha256?: string;
    uppercaseIntegrity?: boolean;
    mode?: number;
  };
};

type BroadcastMessage = {
  type?: string;
  payload?: Record<string, unknown>;
};

type BroadcastEnvelope = {
  message?: BroadcastMessage;
  audience?: unknown;
};

export type BroadcastEvent = {
  message: {
    type: string;
    payload?: Record<string, unknown>;
  };
  audience?: unknown;
};

type PlannerAuditPointer = {
  plan_id?: string;
  step_index?: number;
};

export type PluginTestContainer = ReturnType<typeof createContainer>;

function pluginLockJson(opts: { pinnedVersion: string; integritySha256: string }): string {
  return JSON.stringify(
    {
      format: "tyrum.plugin.lock.v1",
      recorded_at: new Date().toISOString(),
      source: { kind: "local", spec: "test" },
      pinned_version: opts.pinnedVersion,
      integrity_sha256: opts.integritySha256,
    },
    null,
    2,
  );
}

function parseJsonRecord(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

export function createCapturingLogger(): { logger: Logger; warnings: CapturedLog[] } {
  const warnings: CapturedLog[] = [];

  const makeLogger = (): unknown => ({
    child: (_fields: Record<string, unknown>) => makeLogger(),
    debug: (_msg: string, _fields?: Record<string, unknown>) => {},
    info: (_msg: string, _fields?: Record<string, unknown>) => {},
    warn: (msg: string, fields: Record<string, unknown> = {}) => {
      warnings.push({ msg, fields });
    },
    error: (_msg: string, _fields?: Record<string, unknown>) => {},
  });

  return { logger: makeLogger() as Logger, warnings };
}

export function createSilentLogger(): Logger {
  return new Logger({ level: "silent" });
}

export async function createEchoPluginHome(opts: EchoPluginFixtureOptions = {}): Promise<{
  home: string;
  integritySha256: string;
  pluginDir: string;
  pluginsRoot: string;
}> {
  const home = await mkdtemp(join(tmpdir(), "tyrum-plugin-home-"));
  const pluginsRoot = join(home, "plugins");
  const pluginDir = join(pluginsRoot, opts.pluginDirName ?? "echo");
  const manifestRaw = opts.manifest ?? pluginManifestYaml(opts.manifestOpts);
  const entryRaw = opts.entry === undefined ? pluginEntryModule() : opts.entry;
  const integritySha256 = pluginIntegritySha256Hex(manifestRaw, entryRaw ?? pluginEntryModule());

  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "plugin.yml"), manifestRaw, "utf-8");

  if (entryRaw !== null) {
    await writeFile(join(pluginDir, "index.mjs"), entryRaw, "utf-8");
  }

  if (opts.config) {
    await writeFile(join(pluginDir, opts.config.fileName), opts.config.raw, "utf-8");
  }

  for (const file of opts.files ?? []) {
    const baseDir =
      file.base === "home" ? home : file.base === "pluginsRoot" ? pluginsRoot : pluginDir;
    const filePath = join(baseDir, file.relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.raw, "utf-8");
  }

  if (opts.lock) {
    const lockPath = join(pluginDir, "plugin.lock.json");
    const lockRaw = pluginLockJson({
      pinnedVersion: opts.lock.pinnedVersion,
      integritySha256: opts.lock.uppercaseIntegrity
        ? (opts.lock.integritySha256 ?? integritySha256).toUpperCase()
        : (opts.lock.integritySha256 ?? integritySha256),
    });
    await writeFile(lockPath, lockRaw, "utf-8");

    if (opts.lock.mode !== undefined) {
      await chmod(lockPath, opts.lock.mode);
    }
  }

  return { home, integritySha256, pluginDir, pluginsRoot };
}

export function createTestContainer(home: string): PluginTestContainer {
  return createContainer({
    dbPath: ":memory:",
    migrationsDir: SQLITE_MIGRATIONS_DIR,
    tyrumHome: home,
  });
}

export async function withTestContainer<T>(
  home: string,
  run: (container: PluginTestContainer) => Promise<T>,
): Promise<T> {
  const container = createTestContainer(home);

  try {
    return await run(container);
  } finally {
    await container.db.close();
  }
}

export function echoToolCall(
  home: string,
  overrides: Partial<Parameters<PluginRegistry["executeTool"]>[0]> = {},
): Parameters<PluginRegistry["executeTool"]>[0] {
  return {
    toolId: "plugin.echo.echo",
    toolCallId: "call-1",
    args: { text: "hi" },
    home,
    agentId: DEFAULT_AGENT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    ...overrides,
  };
}

export async function countBroadcastEvents(container: PluginTestContainer): Promise<number> {
  const row = await container.db.get<{ count: number }>(
    "SELECT COUNT(1) AS count FROM outbox WHERE tenant_id = ? AND topic = ?",
    [DEFAULT_TENANT_ID, "ws.broadcast"],
  );

  return row?.count ?? 0;
}

export async function listBroadcastEvents(
  container: PluginTestContainer,
): Promise<BroadcastEvent[]> {
  const rows = await container.db.all<{ payload_json: string }>(
    "SELECT payload_json FROM outbox WHERE tenant_id = ? AND topic = ? ORDER BY id ASC",
    [DEFAULT_TENANT_ID, "ws.broadcast"],
  );

  return rows
    .map((row) => JSON.parse(row.payload_json) as BroadcastEnvelope)
    .filter((row): row is BroadcastEvent =>
      Boolean(row.message && typeof row.message.type === "string"),
    );
}

export async function findBroadcastEvent(
  container: PluginTestContainer,
  predicate: (row: BroadcastEvent) => boolean,
): Promise<BroadcastEvent | undefined> {
  return (await listBroadcastEvents(container)).find(predicate);
}

export async function getLastBroadcastEvent(
  container: PluginTestContainer,
): Promise<BroadcastEnvelope | undefined> {
  const row = await container.db.get<{ payload_json: string }>(
    "SELECT payload_json FROM outbox WHERE tenant_id = ? AND topic = ? ORDER BY id DESC LIMIT 1",
    [DEFAULT_TENANT_ID, "ws.broadcast"],
  );

  return row ? (JSON.parse(row.payload_json) as BroadcastEnvelope) : undefined;
}

export async function countPlannerEventsOfType(
  container: PluginTestContainer,
  type: string,
): Promise<number> {
  const rows = await container.db.all<{ action: string }>(
    "SELECT action_json AS action FROM planner_events",
  );

  return rows.filter((row) => parseJsonRecord(row.action)?.["type"] === type).length;
}

export async function expectPlannerAuditEvent(
  container: PluginTestContainer,
  opts: {
    planKey: string;
    stepIndex: number;
    expectedAction: Record<string, unknown>;
    expectEventHash?: boolean;
    expectStepIndex?: number;
  },
): Promise<void> {
  const planRow = await container.db.get<{ plan_id: string }>(
    "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ?",
    [DEFAULT_TENANT_ID, opts.planKey],
  );
  expect(planRow?.plan_id).toBeTruthy();

  const auditRow = await container.db.get<{
    step_index?: number;
    action_json: string;
    event_hash?: string | null;
  }>(
    `SELECT step_index, action_json, event_hash
     FROM planner_events
     WHERE tenant_id = ?
       AND plan_id = ?
       AND step_index = ?`,
    [DEFAULT_TENANT_ID, planRow?.plan_id ?? "", opts.stepIndex],
  );

  if (opts.expectStepIndex !== undefined) {
    expect(auditRow?.step_index).toBe(opts.expectStepIndex);
  }

  if (opts.expectEventHash) {
    expect(auditRow?.event_hash).toMatch(/^[0-9a-f]{64}$/i);
  }

  const action = parseJsonRecord(auditRow?.action_json);
  for (const [key, value] of Object.entries(opts.expectedAction)) {
    expect(action?.[key]).toEqual(value);
  }
}

export async function expectLifecycleAuditLinkage(
  container: PluginTestContainer,
  event: BroadcastEvent | undefined,
  expected: { kind: string; pluginId: string; reason?: string },
): Promise<void> {
  expect(event).toBeTruthy();
  expect(event?.audience).toEqual({ roles: ["client"] });

  const payload = event?.message.payload;
  expect(payload?.["kind"]).toBe(expected.kind);
  expect((payload?.["plugin"] as { id?: string } | undefined)?.id).toBe(expected.pluginId);

  if (expected.reason !== undefined) {
    expect(payload?.["reason"]).toBe(expected.reason);
  }

  const audit = payload?.["audit"] as PlannerAuditPointer | undefined;
  expect(audit?.plan_id).toBe("gateway.plugins.lifecycle");

  await expectPlannerAuditEvent(container, {
    planKey: audit?.plan_id ?? "",
    stepIndex: audit?.step_index ?? -1,
    expectEventHash: expected.kind === "loaded",
    expectStepIndex: audit?.step_index,
    expectedAction: {
      type: "plugin.lifecycle",
      kind: expected.kind,
      plugin_id: expected.pluginId,
      ...(expected.reason ? { reason: expected.reason } : {}),
    },
  });
}

export async function expectToolInvokedAuditLinkage(
  container: PluginTestContainer,
  event: BroadcastEnvelope | undefined,
  expected: {
    planKey: string;
    pluginId: string;
    toolId: string;
    toolCallId: string;
    policySnapshotId?: string;
  },
): Promise<void> {
  expect(event?.audience).toEqual({ roles: ["client"] });
  expect(event?.message?.type).toBe("plugin_tool.invoked");

  const payload = event?.message?.payload;
  expect(payload?.["plugin_id"]).toBe(expected.pluginId);
  expect(payload?.["tool_id"]).toBe(expected.toolId);
  expect(payload?.["tool_call_id"]).toBe(expected.toolCallId);

  if (expected.policySnapshotId !== undefined) {
    expect(payload?.["policy_snapshot_id"]).toBe(expected.policySnapshotId);
  }

  const audit = payload?.["audit"] as PlannerAuditPointer | undefined;
  expect(audit?.plan_id).toBe(expected.planKey);

  await expectPlannerAuditEvent(container, {
    planKey: audit?.plan_id ?? "",
    stepIndex: audit?.step_index ?? -1,
    expectStepIndex: audit?.step_index,
    expectedAction: {
      type: "plugin_tool.invoked",
      plugin_id: expected.pluginId,
      tool_id: expected.toolId,
      tool_call_id: expected.toolCallId,
    },
  });
}
