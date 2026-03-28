import type { ActionPrimitive } from "@tyrum/contracts";

export type ScheduleKind = "heartbeat" | "cron";
export type ScheduleDeliveryMode = "quiet" | "notify";

export type ScheduleCadence =
  | {
      type: "interval";
      interval_ms: number;
    }
  | {
      type: "cron";
      expression: string;
      timezone: string;
    };

export type ScheduleExecution =
  | {
      kind: "agent_turn";
      instruction?: string;
    }
  | {
      kind: "playbook";
      playbook_id: string;
    }
  | {
      kind: "steps";
      steps: ActionPrimitive[];
    };

export type StoredScheduleConfig = {
  v: 1;
  schedule_kind: ScheduleKind;
  enabled: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery: {
    mode: ScheduleDeliveryMode;
  };
  seeded_default?: boolean;
  key?: string;
};

export type NormalizedScheduleConfig = StoredScheduleConfig;

export type ScheduleRecord = {
  schedule_id: string;
  watcher_key: string;
  kind: ScheduleKind;
  enabled: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery: {
    mode: ScheduleDeliveryMode;
  };
  seeded_default: boolean;
  deleted: boolean;
  target_scope: {
    agent_key: string;
    workspace_key: string;
  };
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
  next_fire_at: string | null;
};

export type CreateScheduleInput = {
  tenantId: string;
  agentKey?: string;
  workspaceKey?: string;
  kind: ScheduleKind;
  enabled?: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery?: {
    mode?: ScheduleDeliveryMode;
  };
  watcherKey?: string;
  seededDefault?: boolean;
  lastFiredAtMs?: number | null;
};

export type UpdateScheduleInput = {
  enabled?: boolean;
  cadence?: ScheduleCadence;
  execution?: ScheduleExecution;
  delivery?: {
    mode?: ScheduleDeliveryMode;
  };
  kind?: ScheduleKind;
};

export type RawScheduleRow = {
  tenant_id: string;
  watcher_id: string;
  watcher_key: string;
  agent_id: string;
  agent_key: string;
  workspace_id: string;
  workspace_key: string;
  trigger_type: string;
  trigger_config_json: string;
  active: number | boolean;
  last_fired_at_ms: number | null;
  created_at: string | Date;
  updated_at: string | Date;
};
