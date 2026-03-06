import type { ActionPrimitive } from "@tyrum/client";

export const WORKFLOW_LANES = ["main", "cron", "heartbeat", "subagent"] as const;
export type WorkflowLane = (typeof WORKFLOW_LANES)[number];

export function isWorkflowLane(value: string): value is WorkflowLane {
  return (WORKFLOW_LANES as readonly string[]).includes(value);
}

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "config_set";
      gateway_url: string;
      auth_token: string;
      tls_cert_fingerprint256?: string;
      tls_allow_self_signed?: boolean;
    }
  | { kind: "config_show" }
  | { kind: "identity_init" }
  | { kind: "identity_show" }
  | { kind: "elevated_mode_enter"; ttl_seconds?: number }
  | { kind: "elevated_mode_status" }
  | { kind: "elevated_mode_exit" }
  | { kind: "approvals_list"; limit: number }
  | {
      kind: "approvals_resolve";
      approval_id: string;
      decision: "approved" | "denied";
      reason?: string;
    }
  | { kind: "workflow_run"; key: string; lane: WorkflowLane; steps: ActionPrimitive[] }
  | { kind: "workflow_resume"; token: string }
  | { kind: "workflow_cancel"; run_id: string; reason?: string }
  | {
      kind: "memory_search";
      query: string;
      filter?: Record<string, unknown>;
      limit?: number;
      cursor?: string;
    }
  | { kind: "memory_list"; filter?: Record<string, unknown>; limit?: number; cursor?: string }
  | { kind: "memory_read"; id: string }
  | { kind: "memory_create"; item: Record<string, unknown> }
  | { kind: "memory_update"; id: string; patch: Record<string, unknown> }
  | { kind: "memory_delete"; id: string; reason?: string }
  | { kind: "memory_forget"; selectors: unknown[] }
  | { kind: "memory_export"; filter?: Record<string, unknown>; include_tombstones: boolean }
  | {
      kind: "pairing_approve";
      pairing_id: number;
      trust_level: "local" | "remote";
      capability_allowlist: Array<{ id: string; version: string }>;
      reason?: string;
    }
  | { kind: "pairing_deny"; pairing_id: number; reason?: string }
  | { kind: "pairing_revoke"; pairing_id: number; reason?: string }
  | { kind: "secrets_list"; elevated_token?: string }
  | {
      kind: "secrets_store";
      elevated_token?: string;
      secret_key: string;
      value: string;
    }
  | { kind: "secrets_revoke"; elevated_token?: string; handle_id: string }
  | { kind: "secrets_rotate"; elevated_token?: string; handle_id: string; value: string }
  | { kind: "policy_bundle"; elevated_token?: string }
  | { kind: "policy_overrides_list"; elevated_token?: string }
  | {
      kind: "policy_overrides_create";
      elevated_token?: string;
      agent_id: string;
      tool_id: string;
      pattern: string;
      workspace_id?: string;
    }
  | {
      kind: "policy_overrides_revoke";
      elevated_token?: string;
      policy_override_id: string;
      reason?: string;
    };
