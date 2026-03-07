import { vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
export { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID };
import type { SqlDb, RunResult } from "../../src/statestore/types.js";

export const DEFAULT_SCOPE = {
  tenant_id: DEFAULT_TENANT_ID,
  agent_id: DEFAULT_AGENT_ID,
  workspace_id: DEFAULT_WORKSPACE_ID,
} as const;

export function action(
  type: ActionPrimitive["type"],
  args?: Record<string, unknown>,
): ActionPrimitive {
  return {
    type,
    args: args ?? {},
  };
}

export async function enqueuePlan(
  engine: ExecutionEngine,
  input: Record<string, unknown>,
): Promise<{ jobId: string; runId: string }> {
  const rawTenantId = input["tenantId"];
  const tenantId =
    typeof rawTenantId === "string" && rawTenantId.trim().length > 0
      ? rawTenantId.trim()
      : DEFAULT_TENANT_ID;
  const { tenantId: _ignored, ...rest } = input;
  return await ExecutionEngine.prototype.enqueuePlan.call(engine, {
    tenantId,
    ...(rest as Record<string, unknown>),
  } as never);
}

export async function drain(
  engine: ExecutionEngine,
  workerId: string,
  executor: StepExecutor,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const worked = await engine.workerTick({ workerId, executor });
    if (!worked) return;
  }
  throw new Error("worker did not become idle after 25 ticks");
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function successExecutor(): StepExecutor {
  return {
    execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
  };
}

export function mockCallCount(executor: StepExecutor): number {
  return (executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

export class AbortableTx implements SqlDb {
  readonly kind: SqlDb["kind"];
  private aborted = false;

  constructor(
    private readonly inner: SqlDb,
    private readonly opts: { abortOnSql: (sql: string) => boolean },
  ) {
    this.kind = inner.kind;
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return await this.execWithAbortHandling(() => this.inner.get<T>(sql, params), sql);
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return await this.execWithAbortHandling(() => this.inner.all<T>(sql, params), sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    return await this.execWithAbortHandling(() => this.inner.run(sql, params), sql);
  }

  async exec(sql: string): Promise<void> {
    await this.execWithAbortHandling(() => this.inner.exec(sql), sql);
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    return await this.inner.transaction(fn);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  private async execWithAbortHandling<T>(fn: () => Promise<T>, sql: string): Promise<T> {
    const normalized = sql.trim().toUpperCase();
    const isRollback = normalized === "ROLLBACK" || normalized.startsWith("ROLLBACK TO SAVEPOINT ");
    if (this.aborted && !isRollback) {
      throw new Error("current transaction is aborted, commands ignored until end of transaction");
    }

    if (this.opts.abortOnSql(sql)) {
      this.aborted = true;
      throw new Error("synthetic statement failure");
    }

    try {
      const res = await fn();
      if (isRollback) {
        this.aborted = false;
      }
      return res;
    } catch (err) {
      this.aborted = true;
      throw err;
    }
  }
}
