import type { ActionPrimitive, Lane as LaneT, Playbook, PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import { ActionPrimitive as ActionPrimitiveSchema, PolicyBundle } from "@tyrum/schemas";
import {
  defaultHeartbeatInstruction,
  parseScheduleConfig,
  type NormalizedScheduleConfig,
} from "../automation/schedule-service.js";
import type { WatcherFiringRow } from "./firing-dal.js";

export interface RawPeriodicWatcherRow {
  tenant_id: string;
  watcher_id: string;
  watcher_key: string;
  agent_id: string;
  workspace_id: string;
  trigger_type: string;
  trigger_config_json: string;
  active: number | boolean;
  last_fired_at_ms?: number | null;
  created_at: string;
  updated_at: string;
}

export type SchedulerPeriodicConfig = Omit<NormalizedScheduleConfig, "lane"> & {
  lane?: LaneT;
  laneRaw?: string;
};

export interface WatcherScopeKeys {
  tenant_key: string;
  workspace_key: string;
  agent_key: string;
}

export function parsePeriodicConfig(raw: string): SchedulerPeriodicConfig | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Intentional: malformed periodic config disables that schedule instead of crashing the poller.
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const laneRaw = typeof record["lane"] === "string" ? record["lane"].trim() : undefined;
  const parsedLane = laneRaw === "heartbeat" || laneRaw === "cron" ? laneRaw : undefined;
  const normalized = parseScheduleConfig(raw);
  if (normalized) {
    if (laneRaw && !parsedLane && record["schedule_kind"] === undefined) {
      return { ...normalized, lane: undefined, laneRaw };
    }
    return { ...normalized, laneRaw };
  }

  const intervalMs = record["intervalMs"];
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return undefined;
  }
  let execution: NormalizedScheduleConfig["execution"] | undefined;
  if (Array.isArray(record["steps"])) {
    const steps: ActionPrimitive[] = [];
    for (const entry of record["steps"]) {
      const parsedStep = ActionPrimitiveSchema.safeParse(entry);
      if (!parsedStep.success) return undefined;
      steps.push(parsedStep.data);
    }
    if (steps.length > 0) {
      execution = { kind: "steps", steps };
    }
  }
  if (!execution) {
    const playbookId =
      typeof record["playbook_id"] === "string"
        ? record["playbook_id"].trim()
        : typeof record["planId"] === "string"
          ? record["planId"].trim()
          : "";
    if (playbookId) execution = { kind: "playbook", playbook_id: playbookId };
  }
  if (!execution) {
    // Preserve legacy intervalMs-only watchers so they still create firings
    // and surface the missing execution target during processing.
    execution = { kind: "playbook", playbook_id: "" };
  }

  return {
    v: 1,
    schedule_kind: parsedLane === "heartbeat" ? "heartbeat" : "cron",
    enabled: record["enabled"] !== false,
    cadence: { type: "interval", interval_ms: Math.floor(intervalMs) },
    execution,
    delivery: { mode: parsedLane === "heartbeat" ? "quiet" : "notify" },
    ...(typeof record["key"] === "string" && record["key"].trim()
      ? { key: record["key"].trim() }
      : {}),
    ...(parsedLane ? { lane: parsedLane } : {}),
    laneRaw,
  };
}

export function resolvePlaybookBundle(playbook: Playbook): PolicyBundleT | undefined {
  const allowed = playbook.manifest.allowed_domains ?? [];
  if (!Array.isArray(allowed) || allowed.length === 0) return undefined;
  return PolicyBundle.parse({
    v: 1,
    network_egress: {
      default: "require_approval",
      allow: allowed.flatMap((d) => [`https://${d}/*`, `http://${d}/*`]),
      require_approval: [],
      deny: [],
    },
  });
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getPlanId(cfg: SchedulerPeriodicConfig | undefined): string {
  return cfg?.execution.kind === "playbook"
    ? cfg.execution.playbook_id
    : cfg?.execution.kind === "agent_turn"
      ? cfg.schedule_kind
      : "";
}

export function buildAutomationTurnRequest(input: {
  watcher: RawPeriodicWatcherRow;
  firing: WatcherFiringRow;
  config: SchedulerPeriodicConfig;
  tenantKey: string;
  agentKey: string;
  workspaceKey: string;
}): Record<string, unknown> {
  const kind = input.config.schedule_kind;
  const instruction =
    input.config.execution.kind === "agent_turn"
      ? input.config.execution.instruction?.trim() || defaultHeartbeatInstruction()
      : undefined;
  const previousFiredAtIso = input.watcher.last_fired_at_ms
    ? new Date(input.watcher.last_fired_at_ms).toISOString()
    : null;
  const firedAtIso = new Date(input.firing.scheduled_at_ms).toISOString();

  const messageLines = [
    `Automation trigger: ${kind}`,
    `Schedule id: ${input.watcher.watcher_id}`,
    `Watcher key: ${input.watcher.watcher_key}`,
    `Fired at: ${firedAtIso}`,
    `Previous fired at: ${previousFiredAtIso ?? "never"}`,
    `Delivery mode: ${input.config.delivery.mode}`,
    `Cadence: ${
      input.config.cadence.type === "interval"
        ? `every ${String(input.config.cadence.interval_ms)}ms`
        : `${input.config.cadence.expression} (${input.config.cadence.timezone})`
    }`,
    "",
    "Instruction:",
    instruction ?? "Review context and act according to the configured automation schedule.",
  ];
  if (kind === "heartbeat" && input.config.delivery.mode === "quiet")
    messageLines.push("", "Return an empty reply when there is no useful user-facing action.");

  return {
    tenant_key: input.tenantKey,
    agent_key: input.agentKey,
    workspace_key: input.workspaceKey,
    channel: "automation:default",
    thread_id: `schedule-${input.watcher.watcher_id}`,
    container_kind: "channel",
    message: messageLines.join("\n"),
    metadata: {
      automation: {
        schedule_id: input.watcher.watcher_id,
        watcher_key: input.watcher.watcher_key,
        schedule_kind: kind,
        fired_at: firedAtIso,
        previous_fired_at: previousFiredAtIso,
        cadence: input.config.cadence,
        delivery_mode: input.config.delivery.mode,
        seeded_default: input.config.seeded_default === true,
        instruction,
      },
    },
  };
}
