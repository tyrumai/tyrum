import type { Playbook, PolicyBundle as PolicyBundleT } from "@tyrum/contracts";
import { AgentConversationKey, PolicyBundle } from "@tyrum/contracts";
import {
  defaultHeartbeatInstruction,
  parseScheduleConfig,
  type NormalizedScheduleConfig,
} from "../automation/schedule-service.js";
import { resolveAutomationConversationRoute } from "../automation/conversation-routing.js";
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

export type SchedulerPeriodicConfig = NormalizedScheduleConfig;

export interface WatcherScopeKeys {
  tenant_key: string;
  workspace_key: string;
  agent_key: string;
}

export function parsePeriodicConfig(raw: string): SchedulerPeriodicConfig | undefined {
  return parseScheduleConfig(raw);
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
  key: string;
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

  const target =
    kind === "heartbeat"
      ? resolveHeartbeatAutomationTarget(input)
      : {
          channel: "automation:default",
          threadId: `schedule-${input.watcher.watcher_id}`,
          containerKind: "channel" as const,
        };

  return {
    tenant_key: input.tenantKey,
    agent_key: input.agentKey,
    workspace_key: input.workspaceKey,
    channel: target.channel,
    thread_id: target.threadId,
    container_kind: target.containerKind,
    parts: [{ type: "text", text: messageLines.join("\n") }],
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

function resolveHeartbeatAutomationTarget(input: {
  key: string;
  agentKey: string;
  workspaceKey: string;
}): { channel: string; threadId: string; containerKind: "channel" } {
  const parsedKey = AgentConversationKey.safeParse(input.key);
  if (!parsedKey.success) {
    throw new Error("heartbeat schedule key must be an agent conversation key");
  }
  const route = resolveAutomationConversationRoute(parsedKey.data);
  if (route.agentKey !== input.agentKey || route.workspaceKey !== input.workspaceKey) {
    throw new Error("heartbeat schedule key does not match watcher scope");
  }

  return {
    channel: `automation:${route.deliveryAccount}`,
    threadId: route.threadId,
    containerKind: route.containerKind,
  };
}
