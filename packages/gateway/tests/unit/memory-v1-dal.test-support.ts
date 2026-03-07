import type { MemoryItemCreateInput, MemoryProvenance } from "@tyrum/schemas";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

export const OBSERVED_AT = "2026-02-19T12:00:00Z";

type MemoryItemByKind<K extends MemoryItemCreateInput["kind"]> = Extract<
  MemoryItemCreateInput,
  { kind: K }
>;

type ProvenanceOverrides = Partial<Omit<MemoryProvenance, "source_kind">>;

export type OpenDalResult = { dal: MemoryV1Dal; db: SqlDb; close: () => Promise<void> };
export type MemoryV1DalFixture = {
  name: "sqlite" | "postgres";
  open: () => Promise<OpenDalResult>;
};
export type AgentScopes = Awaited<ReturnType<typeof ensureAgentScopes>>;

async function openSqliteDal(): Promise<OpenDalResult> {
  const db = openTestSqliteDb();
  return {
    dal: new MemoryV1Dal(db),
    db,
    close: async () => {
      await db.close();
    },
  };
}

async function openPostgresDal(): Promise<OpenDalResult> {
  const { db, close } = await openTestPostgresDb();
  return { dal: new MemoryV1Dal(db), db, close };
}

export const memoryV1DalFixtures: readonly MemoryV1DalFixture[] = [
  { name: "sqlite", open: openSqliteDal },
  { name: "postgres", open: openPostgresDal },
];

export async function ensureAgentScopes(db: SqlDb): Promise<{
  tenantId: string;
  scopeA: { tenantId: string; agentId: string };
  scopeB: { tenantId: string; agentId: string };
}> {
  const identity = new IdentityScopeDal(db, { cacheTtlMs: 0 });
  const tenantId = await identity.ensureTenantId("default");
  const agentAId = await identity.ensureAgentId(tenantId, "agent-a");
  const agentBId = await identity.ensureAgentId(tenantId, "agent-b");
  return {
    tenantId,
    scopeA: { tenantId, agentId: agentAId },
    scopeB: { tenantId, agentId: agentBId },
  };
}

export async function withOpenDal<T>(
  fixture: MemoryV1DalFixture,
  run: (ctx: Omit<OpenDalResult, "close">) => Promise<T>,
): Promise<T> {
  const { close, ...ctx } = await fixture.open();
  try {
    return await run(ctx);
  } finally {
    await close();
  }
}

export function operatorProvenance(overrides: ProvenanceOverrides = {}): MemoryProvenance {
  return { source_kind: "operator", refs: [], ...overrides };
}

export function userProvenance(overrides: ProvenanceOverrides = {}): MemoryProvenance {
  return { source_kind: "user", refs: [], ...overrides };
}

export function noteInput(
  overrides: Partial<MemoryItemByKind<"note">> = {},
): MemoryItemByKind<"note"> {
  return {
    kind: "note",
    body_md: "note body",
    tags: [],
    sensitivity: "private",
    provenance: operatorProvenance(),
    ...overrides,
  };
}

export function factInput(
  overrides: Partial<MemoryItemByKind<"fact">> = {},
): MemoryItemByKind<"fact"> {
  return {
    kind: "fact",
    key: "fact-key",
    value: "fact-value",
    observed_at: OBSERVED_AT,
    confidence: 0.5,
    tags: [],
    sensitivity: "private",
    provenance: operatorProvenance(),
    ...overrides,
  };
}

export function episodeInput(
  overrides: Partial<MemoryItemByKind<"episode">> = {},
): MemoryItemByKind<"episode"> {
  return {
    kind: "episode",
    occurred_at: OBSERVED_AT,
    summary_md: "episode summary",
    tags: [],
    sensitivity: "private",
    provenance: operatorProvenance(),
    ...overrides,
  };
}
