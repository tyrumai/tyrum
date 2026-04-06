import {
  AttemptCost,
  type AttemptCost as AttemptCostT,
  type TyrumUIMessage,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { coerceRecord } from "../util/coerce.js";

export const TURN_USAGE_METADATA_KEY = "tyrum_usage";

export type UsageTotals = {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  usd_micros: number;
};

export interface LocalUsageSummary {
  total_with_cost: number;
  parsed: number;
  invalid: number;
  totals: UsageTotals;
}

export interface LocalUsageScope {
  tenantId?: string;
  turnId?: string;
  key?: string;
  agentKey?: string;
}

type TurnItemPayloadRow = {
  payload_json: string;
};

type CostJsonRow = {
  cost_json: string | null;
};

export function newUsageTotals(): UsageTotals {
  return {
    duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    usd_micros: 0,
  };
}

function addOptional(total: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? total + value : total;
}

export function addUsageTotals(totals: UsageTotals, cost: AttemptCostT): void {
  totals.duration_ms = addOptional(totals.duration_ms, cost.duration_ms);
  totals.input_tokens = addOptional(totals.input_tokens, cost.input_tokens);
  totals.output_tokens = addOptional(totals.output_tokens, cost.output_tokens);
  totals.total_tokens = addOptional(totals.total_tokens, cost.total_tokens);
  totals.usd_micros = addOptional(totals.usd_micros, cost.usd_micros);
}

export function buildTurnUsageCost(input: {
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): AttemptCostT {
  const durationMs = Math.max(0, Math.floor(input.durationMs));
  return AttemptCost.parse({
    duration_ms: durationMs,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    total_tokens: input.totalTokens,
  });
}

function withTurnUsageCost(message: TyrumUIMessage, cost: AttemptCostT): TyrumUIMessage {
  return {
    ...message,
    metadata: {
      ...message.metadata,
      [TURN_USAGE_METADATA_KEY]: cost,
    },
  };
}

export function attachTurnUsageCost(
  messages: readonly TyrumUIMessage[],
  cost: AttemptCostT | undefined,
): TyrumUIMessage[] {
  if (!cost || messages.length === 0) {
    return messages.slice();
  }

  const lastAssistantIndex = messages.findLastIndex((message) => message.role === "assistant");
  const targetIndex = lastAssistantIndex >= 0 ? lastAssistantIndex : messages.length - 1;
  return messages.map((message, index) =>
    index === targetIndex ? withTurnUsageCost(message, cost) : message,
  );
}

export function parseAttemptCostValue(value: unknown): AttemptCostT | undefined {
  const parsed = AttemptCost.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseAttemptCostJson(raw: string | null | undefined): AttemptCostT | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return parseAttemptCostValue(JSON.parse(raw) as unknown);
  } catch {
    // Intentional: aggregate usage readers skip malformed stored cost payloads.
    return undefined;
  }
}

function extractTurnUsageCost(raw: string): { hasUsage: boolean; cost?: AttemptCostT } {
  if (!raw.includes(`"${TURN_USAGE_METADATA_KEY}"`)) {
    return { hasUsage: false };
  }

  try {
    const payload = coerceRecord(JSON.parse(raw) as unknown);
    const message = coerceRecord(payload?.["message"]);
    const metadata = coerceRecord(message?.["metadata"]);
    return {
      hasUsage: true,
      cost: parseAttemptCostValue(metadata?.[TURN_USAGE_METADATA_KEY]),
    };
  } catch {
    // Intentional: aggregate usage readers treat unreadable message metadata as invalid usage.
    return { hasUsage: true };
  }
}

export function sumAttemptCosts(costs: readonly AttemptCostT[]): AttemptCostT {
  const totals = newUsageTotals();
  for (const cost of costs) {
    addUsageTotals(totals, cost);
  }

  return AttemptCost.parse({
    duration_ms: totals.duration_ms,
    input_tokens: totals.input_tokens,
    output_tokens: totals.output_tokens,
    total_tokens: totals.total_tokens,
    usd_micros: totals.usd_micros,
  });
}

async function loadTurnItemRows(db: SqlDb, scope: LocalUsageScope): Promise<TurnItemPayloadRow[]> {
  if (scope.turnId) {
    const params = scope.tenantId ? [scope.tenantId, scope.turnId] : [scope.turnId];
    const tenantWhere = scope.tenantId ? "tenant_id = ? AND " : "";
    return await db.all<TurnItemPayloadRow>(
      `SELECT payload_json
       FROM turn_items
       WHERE ${tenantWhere}turn_id = ?`,
      params,
    );
  }

  if (scope.key) {
    const params = scope.tenantId ? [scope.tenantId, scope.key] : [scope.key];
    const tenantWhere = scope.tenantId ? "i.tenant_id = ? AND " : "";
    return await db.all<TurnItemPayloadRow>(
      `SELECT i.payload_json
       FROM turn_items i
       JOIN turns r
         ON r.tenant_id = i.tenant_id
        AND r.turn_id = i.turn_id
       WHERE ${tenantWhere}r.conversation_key = ?`,
      params,
    );
  }

  if (scope.agentKey) {
    const keyPrefix = `agent:${scope.agentKey}:`;
    const params = scope.tenantId ? [scope.tenantId, keyPrefix, keyPrefix] : [keyPrefix, keyPrefix];
    const tenantWhere = scope.tenantId ? "i.tenant_id = ? AND " : "";
    return await db.all<TurnItemPayloadRow>(
      `SELECT i.payload_json
       FROM turn_items i
       JOIN turns r
         ON r.tenant_id = i.tenant_id
        AND r.turn_id = i.turn_id
       WHERE ${tenantWhere}substr(r.conversation_key, 1, length(?)) = ?`,
      params,
    );
  }

  if (scope.tenantId) {
    return await db.all<TurnItemPayloadRow>(
      `SELECT payload_json
       FROM turn_items
       WHERE tenant_id = ?`,
      [scope.tenantId],
    );
  }

  return await db.all<TurnItemPayloadRow>(
    `SELECT payload_json
     FROM turn_items`,
  );
}

async function loadWorkflowStepRows(db: SqlDb, scope: LocalUsageScope): Promise<CostJsonRow[]> {
  if (scope.turnId) {
    const params = scope.tenantId ? [scope.tenantId, scope.turnId] : [scope.turnId];
    const tenantWhere = scope.tenantId ? "tenant_id = ? AND " : "";
    return await db.all<CostJsonRow>(
      `SELECT cost_json
       FROM workflow_run_steps
       WHERE ${tenantWhere}workflow_run_id = ?
         AND cost_json IS NOT NULL`,
      params,
    );
  }

  if (scope.key) {
    const params = scope.tenantId ? [scope.tenantId, scope.key] : [scope.key];
    const tenantWhere = scope.tenantId ? "s.tenant_id = ? AND " : "";
    return await db.all<CostJsonRow>(
      `SELECT s.cost_json
       FROM workflow_run_steps s
       JOIN workflow_runs r
         ON r.tenant_id = s.tenant_id
        AND r.workflow_run_id = s.workflow_run_id
       WHERE ${tenantWhere}COALESCE(r.conversation_key, r.run_key) = ?
         AND s.cost_json IS NOT NULL`,
      params,
    );
  }

  if (scope.agentKey) {
    const keyPrefix = `agent:${scope.agentKey}:`;
    const params = scope.tenantId ? [scope.tenantId, keyPrefix, keyPrefix] : [keyPrefix, keyPrefix];
    const tenantWhere = scope.tenantId ? "s.tenant_id = ? AND " : "";
    return await db.all<CostJsonRow>(
      `SELECT s.cost_json
       FROM workflow_run_steps s
       JOIN workflow_runs r
         ON r.tenant_id = s.tenant_id
        AND r.workflow_run_id = s.workflow_run_id
       WHERE ${tenantWhere}substr(COALESCE(r.conversation_key, r.run_key), 1, length(?)) = ?
         AND s.cost_json IS NOT NULL`,
      params,
    );
  }

  if (scope.tenantId) {
    return await db.all<CostJsonRow>(
      `SELECT cost_json
       FROM workflow_run_steps
       WHERE tenant_id = ?
         AND cost_json IS NOT NULL`,
      [scope.tenantId],
    );
  }

  return await db.all<CostJsonRow>(
    `SELECT cost_json
     FROM workflow_run_steps
     WHERE cost_json IS NOT NULL`,
  );
}

export async function computeLocalUsageSummary(
  db: SqlDb,
  scope: LocalUsageScope,
): Promise<LocalUsageSummary> {
  const [turnItemRows, workflowRows] = await Promise.all([
    loadTurnItemRows(db, scope),
    loadWorkflowStepRows(db, scope),
  ]);

  const totals = newUsageTotals();
  let totalWithCost = 0;
  let parsed = 0;
  let invalid = 0;

  for (const row of turnItemRows) {
    const extracted = extractTurnUsageCost(row.payload_json);
    if (!extracted.hasUsage) {
      continue;
    }

    totalWithCost += 1;
    if (!extracted.cost) {
      invalid += 1;
      continue;
    }

    parsed += 1;
    addUsageTotals(totals, extracted.cost);
  }

  for (const row of workflowRows) {
    if (!row.cost_json) {
      continue;
    }

    totalWithCost += 1;
    const cost = parseAttemptCostJson(row.cost_json);
    if (!cost) {
      invalid += 1;
      continue;
    }

    parsed += 1;
    addUsageTotals(totals, cost);
  }

  return {
    total_with_cost: totalWithCost,
    parsed,
    invalid,
    totals,
  };
}
