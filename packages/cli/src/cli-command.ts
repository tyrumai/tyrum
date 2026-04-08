import type { ActionPrimitive } from "@tyrum/contracts";

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
  | { kind: "workflow_start"; conversation_key: string; steps: ActionPrimitive[] }
  | { kind: "workflow_resume"; token: string }
  | { kind: "workflow_cancel"; workflow_run_id: string; reason?: string }
  | { kind: "benchmark_validate"; suite_path: string }
  | {
      kind: "benchmark_run";
      suite_path: string;
      judge_model: string;
      model?: string;
      scenario_id?: string;
      output_dir?: string;
      repeat?: number;
      agent_key?: string;
    }
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
