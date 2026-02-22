import { AttemptCost } from "@tyrum/schemas";
import type { SqlDb, StateStoreKind } from "../../statestore/types.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { PresenceDal } from "../presence/dal.js";
import type { NodePairingDal } from "../node/pairing-dal.js";
import type { PolicyService } from "../policy/service.js";
import type { PolicyOverrideDal } from "../policy/override-dal.js";
import type { ContextReportDal } from "../context/report-dal.js";
import type { PluginRegistry } from "../plugins/registry.js";

export type CommandExecuteResult = {
  output: string;
  data?: unknown;
};

export interface CommandDeps {
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    dbKind: StateStoreKind;
    isExposed: boolean;
    otelEnabled: boolean;
  };
  connectionManager?: ConnectionManager;
  db?: SqlDb;
  approvalDal?: ApprovalDal;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  policyService?: PolicyService;
  policyOverrideDal?: PolicyOverrideDal;
  contextReportDal?: ContextReportDal;
  plugins?: PluginRegistry;
}

function tokensFromCommand(raw: string): string[] {
  const line = raw.trim();
  if (line.length === 0) return [];
  const normalized = line.startsWith("/") ? line.slice(1) : line;
  const trimmed = normalized.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/g).filter((t) => t.length > 0);
}

function jsonBlock(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function formatUsageTotals(value: unknown): string {
  if (!value || typeof value !== "object") return "No usage data available.";
  return jsonBlock(value);
}

type UsageTotals = {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  usd_micros: number;
};

function addOptional(total: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? total + value : total;
}

function newTotals(): UsageTotals {
  return {
    duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    usd_micros: 0,
  };
}

async function computeUsageTotals(db: SqlDb, runId?: string): Promise<{
  attempts_total_with_cost: number;
  attempts_parsed: number;
  attempts_invalid: number;
  totals: UsageTotals;
}> {
  const rows = runId
    ? await db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s ON s.step_id = a.step_id
         WHERE s.run_id = ?
           AND a.cost_json IS NOT NULL`,
        [runId],
      )
    : await db.all<{ cost_json: string | null }>(
        `SELECT cost_json
         FROM execution_attempts
         WHERE cost_json IS NOT NULL`,
      );

  const totals = newTotals();
  let parsed = 0;
  let invalid = 0;

  for (const row of rows) {
    if (!row.cost_json) continue;
    let json: unknown;
    try {
      json = JSON.parse(row.cost_json) as unknown;
    } catch {
      invalid += 1;
      continue;
    }
    const cost = AttemptCost.safeParse(json);
    if (!cost.success) {
      invalid += 1;
      continue;
    }

    parsed += 1;
    totals.duration_ms = addOptional(totals.duration_ms, cost.data.duration_ms);
    totals.input_tokens = addOptional(totals.input_tokens, cost.data.input_tokens);
    totals.output_tokens = addOptional(totals.output_tokens, cost.data.output_tokens);
    totals.total_tokens = addOptional(totals.total_tokens, cost.data.total_tokens);
    totals.usd_micros = addOptional(totals.usd_micros, cost.data.usd_micros);
  }

  return {
    attempts_total_with_cost: rows.length,
    attempts_parsed: parsed,
    attempts_invalid: invalid,
    totals,
  };
}

function helpText(): string {
  return [
    "Available commands:",
    "- /help",
    "- /status",
    "- /presence",
    "- /approvals [pending|approved|denied|expired]",
    "- /pairings [pending|approved|denied|revoked]",
    "- /policy bundle",
    "- /policy overrides list [agent_id] [tool_id] [status]",
    "- /policy overrides revoke <policy_override_id> [reason...]",
    "- /context last",
    "- /context list [limit]",
    "- /context detail <context_report_id>",
    "- /usage [run_id]",
    "",
    "Notes:",
    "- Commands are handled by the gateway (not the model).",
    "- Some commands require optional subsystems (presence, policy, etc.).",
  ].join("\n");
}

export async function executeCommand(raw: string, deps: CommandDeps): Promise<CommandExecuteResult> {
  const toks = tokensFromCommand(raw);
  const cmd = toks[0]?.toLowerCase() ?? "help";

  if (cmd === "help" || cmd === "?") {
    return { output: helpText(), data: { commands: helpText() } };
  }

  if (cmd === "status") {
    const policy = deps.policyService ? await deps.policyService.getStatus() : null;
    const payload = {
      status: "ok",
      runtime: deps.runtime ?? null,
      ws: deps.connectionManager?.getStats() ?? null,
      policy,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "presence") {
    if (!deps.presenceDal) {
      return { output: "Presence is not available on this gateway instance.", data: null };
    }
    const nowMs = Date.now();
    const rows = await deps.presenceDal.listNonExpired(nowMs, 200);
    const payload = { entries: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "approvals") {
    if (!deps.approvalDal) {
      return { output: "Approvals are not available on this gateway instance.", data: null };
    }
    const status = toks[1]?.toLowerCase();
    const allowed = new Set(["pending", "approved", "denied", "expired", "cancelled"]);
    const filter = status && allowed.has(status) ? (status as "pending" | "approved" | "denied" | "expired" | "cancelled") : "pending";
    const rows = await deps.approvalDal.getByStatus(filter);
    const payload = { approvals: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "pairings") {
    if (!deps.nodePairingDal) {
      return { output: "Node pairing is not available on this gateway instance.", data: null };
    }
    const status = toks[1]?.toLowerCase();
    const allowed = new Set(["pending", "approved", "denied", "revoked"]);
    const filter = status && allowed.has(status) ? (status as "pending" | "approved" | "denied" | "revoked") : undefined;
    const rows = await deps.nodePairingDal.list({ status: filter, limit: 100 });
    const payload = { pairings: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "policy") {
    const sub = toks[1]?.toLowerCase();
    if (sub === "bundle") {
      if (!deps.policyService) {
        return { output: "PolicyBundle is not available on this gateway instance.", data: null };
      }
      const effective = await deps.policyService.loadEffectiveBundle();
      const payload = { effective: { sha256: effective.sha256, sources: effective.sources, bundle: effective.bundle } };
      return { output: jsonBlock(payload), data: payload };
    }

    if (sub === "overrides") {
      const action = toks[2]?.toLowerCase() ?? "list";
      if (!deps.policyOverrideDal) {
        return { output: "Policy overrides are not available on this gateway instance.", data: null };
      }

      if (action === "list") {
        const agentId = toks[3];
        const toolId = toks[4];
        const status = toks[5] as "active" | "revoked" | "expired" | undefined;
        const rows = await deps.policyOverrideDal.list({
          agentId: agentId && agentId.trim().length > 0 ? agentId : undefined,
          toolId: toolId && toolId.trim().length > 0 ? toolId : undefined,
          status,
          limit: 100,
        });
        const payload = { overrides: rows };
        return { output: jsonBlock(payload), data: payload };
      }

      if (action === "revoke") {
        const id = toks[3];
        if (!id) {
          return { output: "Usage: /policy overrides revoke <policy_override_id> [reason...]", data: null };
        }
        const reason = toks.slice(4).join(" ").trim() || undefined;
        const row = await deps.policyOverrideDal.revoke({
          policyOverrideId: id,
          revokedBy: { kind: "ws-command" },
          reason,
        });
        if (!row) {
          return { output: `Override ${id} not found or not active.`, data: null };
        }
        const payload = { override: row };
        return { output: jsonBlock(payload), data: payload };
      }

      return { output: "Usage: /policy overrides list|revoke", data: null };
    }

    return { output: "Usage: /policy bundle | /policy overrides ...", data: null };
  }

  if (cmd === "context") {
    const sub = toks[1]?.toLowerCase() ?? "last";

    if (sub === "last") {
      if (!deps.contextReportDal) {
        return { output: "Context reports are not available on this gateway instance.", data: null };
      }
      const rows = await deps.contextReportDal.list({ limit: 1 });
      const row = rows[0];
      if (!row) return { output: "No context reports found.", data: null };
      return { output: jsonBlock(row.report), data: row.report };
    }

    if (sub === "list") {
      if (!deps.contextReportDal) {
        return { output: "Context reports are not available on this gateway instance.", data: null };
      }
      const limitRaw = toks[2];
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
      const rows = await deps.contextReportDal.list({ limit: Number.isFinite(limit) ? limit : 20 });
      const payload = {
        reports: rows.map((r) => ({
          context_report_id: r.context_report_id,
          created_at: r.created_at,
          session_id: r.session_id,
          channel: r.channel,
          thread_id: r.thread_id,
          run_id: r.run_id,
        })),
      };
      return { output: jsonBlock(payload), data: payload };
    }

    if (sub === "detail") {
      const id = toks[2];
      if (!id) {
        return { output: "Usage: /context detail <context_report_id>", data: null };
      }
      if (!deps.contextReportDal) {
        return { output: "Context reports are not available on this gateway instance.", data: null };
      }
      const row = await deps.contextReportDal.getById(id);
      if (!row) {
        return { output: `Context report ${id} not found.`, data: null };
      }
      return { output: jsonBlock(row.report), data: row.report };
    }

    return { output: "Usage: /context last | /context list [limit] | /context detail <id>", data: null };
  }

  if (cmd === "usage") {
    if (!deps.db) {
      return { output: "Usage reporting is not available on this gateway instance.", data: null };
    }
    const runId = toks[1];
    const usage = await computeUsageTotals(deps.db, runId);
    const payload = {
      scope: { kind: runId ? "run" : "deployment", run_id: runId ?? null },
      local: usage,
    };
    return { output: formatUsageTotals(payload), data: payload };
  }

  if (deps.plugins) {
    const res = await deps.plugins.tryExecuteCommand(raw);
    if (res) return res;
  }

  return { output: `Unknown command '${cmd}'. Try /help.`, data: null };
}
