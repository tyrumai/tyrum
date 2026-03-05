import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentConfig } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createMemoryV1BudgetsProvider } from "../../src/modules/memory/v1-budgets-provider.js";

function withBudgetOverrides(
  base: AgentConfigT,
  overrides: Partial<AgentConfigT["memory"]["v1"]["budgets"]>,
): AgentConfigT {
  return AgentConfig.parse({
    ...base,
    memory: {
      ...base.memory,
      v1: {
        ...base.memory.v1,
        budgets: {
          ...base.memory.v1.budgets,
          ...overrides,
          per_kind: {
            ...base.memory.v1.budgets.per_kind,
            ...overrides.per_kind,
          },
        },
      },
    },
  });
}

describe("Memory v1 budgets provider", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("loads per-agent budgets from the latest DB-backed agent config", async () => {
    const identity = new IdentityScopeDal(db);
    const tenantId = await identity.ensureTenantId("t1");
    const agentA = await identity.ensureAgentId(tenantId, "agent-a");
    const agentB = await identity.ensureAgentId(tenantId, "agent-b");

    const base = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      tools: { allow: [] },
    });

    const configA = withBudgetOverrides(base, {
      max_total_items: 1,
      per_kind: {
        note: { ...base.memory.v1.budgets.per_kind.note, max_items: 1 },
      },
    });
    const configB = withBudgetOverrides(base, {
      max_total_items: 2,
      per_kind: {
        note: { ...base.memory.v1.budgets.per_kind.note, max_items: 2 },
      },
    });

    const dal = new AgentConfigDal(db);
    await dal.set({ tenantId, agentId: agentA, config: configA });
    await dal.set({ tenantId, agentId: agentB, config: configB });

    const provider = createMemoryV1BudgetsProvider(db);

    await expect(provider(tenantId, agentA)).resolves.toEqual(configA.memory.v1.budgets);
    await expect(provider(tenantId, agentB)).resolves.toEqual(configB.memory.v1.budgets);
  });
});
