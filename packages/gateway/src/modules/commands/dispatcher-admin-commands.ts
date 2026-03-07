import type { CommandDeps, CommandExecuteResult } from "./dispatcher.js";
import {
  computeUsageTotals,
  formatUsageTotals,
  getProviderUsagePoller,
  jsonBlock,
  resolveTenantId,
} from "./dispatcher-support.js";

type CommandInput = {
  cmd: string;
  deps: CommandDeps;
  toks: string[];
};

export async function tryExecuteAdminCommand(
  input: CommandInput,
): Promise<CommandExecuteResult | undefined> {
  if (input.cmd === "policy") return executePolicyCommand(input.deps, input.toks);
  if (input.cmd === "context") return executeContextCommand(input.deps, input.toks);
  if (input.cmd === "usage") return executeUsageCommand(input.deps, input.toks);
  return undefined;
}

async function executePolicyCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  const tenantId = resolveTenantId(deps);
  const sub = toks[1]?.toLowerCase();
  if (sub === "bundle") {
    if (!deps.policyService) {
      return { output: "PolicyBundle is not available on this gateway instance.", data: null };
    }
    const effective = await deps.policyService.loadEffectiveBundle();
    const payload = {
      effective: {
        sha256: effective.sha256,
        sources: effective.sources,
        bundle: effective.bundle,
      },
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (sub !== "overrides") {
    return { output: "Usage: /policy bundle | /policy overrides ...", data: null };
  }
  if (!deps.policyOverrideDal) {
    return { output: "Policy overrides are not available on this gateway instance.", data: null };
  }

  const action = toks[2]?.toLowerCase() ?? "list";
  if (action === "list") {
    const rows = await deps.policyOverrideDal.list({
      tenantId,
      agentId: toks[3]?.trim() ? toks[3] : undefined,
      toolId: toks[4]?.trim() ? toks[4] : undefined,
      status: toks[5] as "active" | "revoked" | "expired" | undefined,
      limit: 100,
    });
    const payload = { overrides: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (action === "revoke") {
    const id = toks[3];
    if (!id) {
      return {
        output: "Usage: /policy overrides revoke <policy_override_id> [reason...]",
        data: null,
      };
    }
    const row = await deps.policyOverrideDal.revoke({
      tenantId,
      policyOverrideId: id,
      revokedBy: { kind: "ws-command" },
      reason: toks.slice(4).join(" ").trim() || undefined,
    });
    if (!row) return { output: `Override ${id} not found or not active.`, data: null };
    const payload = { override: row };
    return { output: jsonBlock(payload), data: payload };
  }

  if (action === "describe") {
    const id = toks[3];
    if (!id) {
      return { output: "Usage: /policy overrides describe <policy_override_id>", data: null };
    }
    const row = await deps.policyOverrideDal.getById({ tenantId, policyOverrideId: id });
    if (!row) return { output: `Override ${id} not found.`, data: null };
    const payload = { override: row };
    return { output: jsonBlock(payload), data: payload };
  }

  return { output: "Usage: /policy overrides list|describe|revoke", data: null };
}

async function executeContextCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  const sub = toks[1]?.toLowerCase() ?? "last";
  if (!deps.contextReportDal) {
    return { output: "Context reports are not available on this gateway instance.", data: null };
  }

  if (sub === "last") {
    const row = (await deps.contextReportDal.list({ limit: 1 }))[0];
    if (!row) return { output: "No context reports found.", data: null };
    return { output: jsonBlock(row.report), data: row.report };
  }

  if (sub === "list") {
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
    if (!id) return { output: "Usage: /context detail <context_report_id>", data: null };
    const row = await deps.contextReportDal.getById({ contextReportId: id });
    if (!row) return { output: `Context report ${id} not found.`, data: null };
    return { output: jsonBlock(row.report), data: row.report };
  }

  return {
    output: "Usage: /context last | /context list [limit] | /context detail <id>",
    data: null,
  };
}

async function executeUsageCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  const sub = toks[1]?.toLowerCase();
  if (sub === "provider") {
    const poller = getProviderUsagePoller(deps);
    if (!poller) {
      return {
        output: "Provider usage polling is not available on this gateway instance.",
        data: null,
      };
    }
    const provider = await poller.pollLatestPinned();
    return { output: jsonBlock(provider), data: provider };
  }

  if (!deps.db) {
    return { output: "Usage reporting is not available on this gateway instance.", data: null };
  }
  const runId = toks[1];
  const payload = {
    scope: { kind: runId ? "run" : "deployment", run_id: runId ?? null },
    local: await computeUsageTotals(deps.db, runId),
  };
  return { output: formatUsageTotals(payload), data: payload };
}
