import type {
  SubagentDescriptor,
  SubagentStatus,
  WorkClarification,
  WorkClarificationStatus,
} from "@tyrum/contracts";

type RawTime = string | Date;

function normalizeTime(value: RawTime): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeMaybeTime(value: RawTime | null): string | null {
  return value === null ? null : normalizeTime(value);
}

export interface RawSubagentRow {
  subagent_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  parent_conversation_key: string | null;
  work_item_id: string | null;
  work_item_task_id: string | null;
  execution_profile: string;
  conversation_key: string;
  status: string;
  desktop_environment_id: string | null;
  attached_node_id: string | null;
  created_at: RawTime;
  updated_at: RawTime;
  last_heartbeat_at: RawTime | null;
  close_reason: string | null;
  closed_at: RawTime | null;
}

export function toSubagent(raw: RawSubagentRow): SubagentDescriptor {
  return {
    subagent_id: raw.subagent_id,
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    parent_conversation_key: raw.parent_conversation_key ?? undefined,
    work_item_id: raw.work_item_id ?? undefined,
    work_item_task_id: raw.work_item_task_id ?? undefined,
    execution_profile: raw.execution_profile,
    conversation_key: raw.conversation_key,
    status: raw.status as SubagentStatus,
    desktop_environment_id: raw.desktop_environment_id ?? undefined,
    attached_node_id: raw.attached_node_id ?? undefined,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
    last_heartbeat_at: normalizeMaybeTime(raw.last_heartbeat_at) ?? undefined,
    closed_at: normalizeMaybeTime(raw.closed_at) ?? undefined,
  };
}

export interface RawWorkClarificationRow {
  clarification_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id: string;
  status: string;
  question: string;
  requested_by_subagent_id: string | null;
  requested_for_conversation_key: string;
  requested_at: RawTime;
  answered_at: RawTime | null;
  answer_text: string | null;
  answered_by_conversation_key: string | null;
  updated_at: RawTime;
}

export function toWorkClarification(raw: RawWorkClarificationRow): WorkClarification {
  return {
    clarification_id: raw.clarification_id,
    tenant_id: raw.tenant_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    work_item_id: raw.work_item_id,
    status: raw.status as WorkClarificationStatus,
    question: raw.question,
    requested_by_subagent_id: raw.requested_by_subagent_id ?? undefined,
    requested_for_conversation_key: raw.requested_for_conversation_key,
    requested_at: normalizeTime(raw.requested_at),
    answered_at: normalizeMaybeTime(raw.answered_at) ?? undefined,
    answer_text: raw.answer_text ?? undefined,
    answered_by_conversation_key: raw.answered_by_conversation_key ?? undefined,
    updated_at: normalizeTime(raw.updated_at),
  };
}
