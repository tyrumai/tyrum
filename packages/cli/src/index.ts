import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  TyrumClient,
  TyrumHttpClientError,
  createTyrumHttpClient,
  createNodeFileDeviceIdentityStorage,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  type ActionPrimitive,
} from "@tyrum/client";

export const VERSION = "0.1.0";

const WORKFLOW_LANES = ["main", "cron", "heartbeat", "subagent"] as const;
type WorkflowLane = (typeof WORKFLOW_LANES)[number];

function isWorkflowLane(value: string): value is WorkflowLane {
  return (WORKFLOW_LANES as readonly string[]).includes(value);
}

type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "config_set"; gateway_url: string; auth_token: string }
  | { kind: "config_show" }
  | { kind: "identity_init" }
  | { kind: "identity_show" }
  | { kind: "admin_mode_enter"; admin_token: string; ttl_seconds?: number }
  | { kind: "admin_mode_status" }
  | { kind: "admin_mode_exit" }
  | { kind: "approvals_list"; limit: number }
  | {
      kind: "approvals_resolve";
      approval_id: number;
      decision: "approved" | "denied";
      reason?: string;
    }
  | { kind: "workflow_run"; key: string; lane: WorkflowLane; steps: ActionPrimitive[] }
  | { kind: "workflow_resume"; token: string }
  | { kind: "workflow_cancel"; run_id: string; reason?: string }
  | {
      kind: "pairing_approve";
      pairing_id: number;
      trust_level: "local" | "remote";
      capability_allowlist: Array<{ id: string; version: string }>;
      reason?: string;
    }
  | { kind: "pairing_deny"; pairing_id: number; reason?: string }
  | { kind: "pairing_revoke"; pairing_id: number; reason?: string }
  | { kind: "secrets_list"; admin_token?: string }
  | {
      kind: "secrets_store";
      admin_token?: string;
      scope: string;
      provider: "env" | "file" | "keychain";
      value: string;
    }
  | { kind: "secrets_revoke"; admin_token?: string; handle_id: string }
  | { kind: "secrets_rotate"; admin_token?: string; handle_id: string; value: string }
  | { kind: "policy_bundle"; admin_token?: string }
  | { kind: "policy_overrides_list"; admin_token?: string }
  | {
      kind: "policy_overrides_create";
      admin_token?: string;
      agent_id: string;
      tool_id: string;
      pattern: string;
      workspace_id?: string;
    }
  | {
      kind: "policy_overrides_revoke";
      admin_token?: string;
      policy_override_id: string;
      reason?: string;
    };

function resolveTyrumHome(): string {
  const fromEnv = process.env["TYRUM_HOME"]?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".tyrum");
}

function resolveOperatorDir(home = resolveTyrumHome()): string {
  return join(home, "operator");
}

function resolveOperatorConfigPath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "config.json");
}

function resolveOperatorDeviceIdentityPath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "device-identity.json");
}

function resolveOperatorAdminModePath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "admin-mode.json");
}

function resolveGatewayWsUrl(gatewayUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    throw new Error("config.gateway_url must be a valid absolute URL");
  }

  const wsUrl = new URL("/ws", parsed);
  if (wsUrl.protocol === "http:") wsUrl.protocol = "ws:";
  else if (wsUrl.protocol === "https:") wsUrl.protocol = "wss:";
  else if (wsUrl.protocol === "ws:" || wsUrl.protocol === "wss:") {
    // ok
  } else {
    throw new Error("config.gateway_url must use http(s)://");
  }

  return wsUrl.toString();
}

function printCliHelp(): void {
  console.log(
    [
      "tyrum-cli (operator CLI)",
      "",
      "Usage:",
      "  tyrum-cli --help",
      "  tyrum-cli --version",
      "  tyrum-cli config show",
      "  tyrum-cli config set --gateway-url <url> --token <token>",
      "  tyrum-cli identity show",
      "  tyrum-cli identity init",
      "  tyrum-cli admin-mode enter --admin-token <token> [--ttl-seconds <n>]",
      "  tyrum-cli admin-mode status",
      "  tyrum-cli admin-mode exit",
      "  tyrum-cli approvals list [--limit <n>]",
      "  tyrum-cli approvals resolve --approval-id <id> --decision <approved|denied> [--reason <text>]",
      "  tyrum-cli workflow run --key <key> --steps <json> [--lane <lane>]",
      "  tyrum-cli workflow resume --token <resume-token>",
      "  tyrum-cli workflow cancel --run-id <run-id> [--reason <text>]",
      "  tyrum-cli pairing approve --pairing-id <id> --trust-level <local|remote> --capability <id[@version]> [--capability <...>] [--reason <text>]",
      "  tyrum-cli pairing deny --pairing-id <id> [--reason <text>]",
      "  tyrum-cli pairing revoke --pairing-id <id> [--reason <text>]",
      "  tyrum-cli secrets list",
      "  tyrum-cli secrets store --scope <scope> --provider <env|file|keychain> --value <value>",
      "  tyrum-cli secrets revoke --handle-id <handle-id>",
      "  tyrum-cli secrets rotate --handle-id <handle-id> --value <value>",
      "  tyrum-cli policy bundle",
      "  tyrum-cli policy overrides list",
      "  tyrum-cli policy overrides create --agent-id <agent-id> --tool-id <tool-id> --pattern <glob> [--workspace-id <workspace-id>]",
      "  tyrum-cli policy overrides revoke --policy-override-id <id> [--reason <text>]",
      "",
      "Notes:",
      "  - policy/* and secrets/* are admin-only surfaces and require Admin Mode (see `tyrum-cli admin-mode enter`) or an explicit `--admin-token <token>`.",
      "",
      "Environment:",
      "  TYRUM_HOME  Defaults to ~/.tyrum",
    ].join("\n"),
  );
}

function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "help" };

  const [first, second] = argv;
  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "--version") return { kind: "version" };

  if (first === "pairing") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second) throw new Error("pairing requires a subcommand (approve|deny|revoke)");

    const parsePairingId = (raw: string | undefined, flag: string): number => {
      if (!raw) throw new Error(`${flag} requires a value`);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer`);
      }
      return parsed;
    };

    if (second === "approve") {
      let pairingId: number | undefined;
      let trustLevel: "local" | "remote" | undefined;
      const capabilities: Array<{ id: string; version: string }> = [];
      let reason: string | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--pairing-id") {
          pairingId = parsePairingId(argv[i + 1], "--pairing-id");
          i += 1;
          continue;
        }

        if (arg === "--trust-level") {
          const raw = argv[i + 1]?.trim();
          if (!raw) throw new Error("--trust-level requires a value");
          if (raw !== "local" && raw !== "remote") {
            throw new Error("--trust-level must be 'local' or 'remote'");
          }
          trustLevel = raw;
          i += 1;
          continue;
        }

        if (arg === "--capability") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--capability requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--capability requires a non-empty value");
          const [id, versionRaw] = trimmed.split("@", 2);
          const capabilityId = id?.trim() ?? "";
          const version = (versionRaw?.trim() || "1.0.0") as string;
          if (!capabilityId) throw new Error("--capability requires a non-empty id");
          if (!version) throw new Error("--capability version must be non-empty");
          capabilities.push({ id: capabilityId, version });
          i += 1;
          continue;
        }

        if (arg === "--reason") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--reason requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--reason requires a non-empty value");
          reason = trimmed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported pairing.approve argument '${arg}'`);
        }
        throw new Error(`unexpected pairing.approve argument '${arg}'`);
      }

      if (!pairingId) throw new Error("pairing approve requires --pairing-id <id>");
      if (!trustLevel) throw new Error("pairing approve requires --trust-level <local|remote>");
      if (capabilities.length === 0) {
        throw new Error("pairing approve requires at least one --capability <id[@version]>");
      }

      return {
        kind: "pairing_approve",
        pairing_id: pairingId,
        trust_level: trustLevel,
        capability_allowlist: capabilities,
        reason,
      };
    }

    if (second === "deny" || second === "revoke") {
      let pairingId: number | undefined;
      let reason: string | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--pairing-id") {
          pairingId = parsePairingId(argv[i + 1], "--pairing-id");
          i += 1;
          continue;
        }

        if (arg === "--reason") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--reason requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--reason requires a non-empty value");
          reason = trimmed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported pairing.${second} argument '${arg}'`);
        }
        throw new Error(`unexpected pairing.${second} argument '${arg}'`);
      }

      if (!pairingId) throw new Error(`pairing ${second} requires --pairing-id <id>`);
      if (second === "deny") return { kind: "pairing_deny", pairing_id: pairingId, reason };
      return { kind: "pairing_revoke", pairing_id: pairingId, reason };
    }

    throw new Error(`unknown pairing subcommand '${second}'`);
  }

  if (first === "secrets") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second) throw new Error("secrets requires a subcommand (store|list|revoke|rotate)");

    if (second === "list") {
      let adminToken: string | undefined;
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--admin-token") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--admin-token requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--admin-token requires a non-empty value");
          adminToken = trimmed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) throw new Error(`unsupported secrets.list argument '${arg}'`);
        throw new Error(`unexpected secrets.list argument '${arg}'`);
      }
      return { kind: "secrets_list", admin_token: adminToken };
    }

    if (second === "store") {
      let adminToken: string | undefined;
      let scope: string | undefined;
      let provider: "env" | "file" | "keychain" = "env";
      let value: string | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--admin-token") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--admin-token requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--admin-token requires a non-empty value");
          adminToken = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--scope") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--scope requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--scope requires a non-empty value");
          scope = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--provider") {
          const raw = argv[i + 1]?.trim();
          if (!raw) throw new Error("--provider requires a value");
          if (raw !== "env" && raw !== "file" && raw !== "keychain") {
            throw new Error("--provider must be env, file, or keychain");
          }
          provider = raw;
          i += 1;
          continue;
        }

        if (arg === "--value") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--value requires a value");
          value = raw;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) throw new Error(`unsupported secrets.store argument '${arg}'`);
        throw new Error(`unexpected secrets.store argument '${arg}'`);
      }

      if (!scope) throw new Error("secrets store requires --scope <scope>");
      if (!value) throw new Error("secrets store requires --value <value>");
      return { kind: "secrets_store", admin_token: adminToken, scope, provider, value };
    }

    if (second === "revoke" || second === "rotate") {
      let adminToken: string | undefined;
      let handleId: string | undefined;
      let value: string | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--admin-token") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--admin-token requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--admin-token requires a non-empty value");
          adminToken = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--handle-id") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--handle-id requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--handle-id requires a non-empty value");
          handleId = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--value") {
          if (second === "revoke") {
            throw new Error(
              "secrets revoke does not accept --value (did you mean 'tyrum-cli secrets rotate'?)",
            );
          }
          const raw = argv[i + 1];
          if (!raw) throw new Error("--value requires a value");
          value = raw;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) throw new Error(`unsupported secrets.${second} argument '${arg}'`);
        throw new Error(`unexpected secrets.${second} argument '${arg}'`);
      }

      if (!handleId) throw new Error(`secrets ${second} requires --handle-id <handle-id>`);

      if (second === "revoke") {
        return { kind: "secrets_revoke", admin_token: adminToken, handle_id: handleId };
      }

      if (!value) throw new Error("secrets rotate requires --value <value>");
      return { kind: "secrets_rotate", admin_token: adminToken, handle_id: handleId, value };
    }

    throw new Error(`unknown secrets subcommand '${second}'`);
  }

  if (first === "policy") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second) throw new Error("policy requires a subcommand (bundle|overrides)");

    if (second === "bundle") {
      let adminToken: string | undefined;
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--admin-token") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--admin-token requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--admin-token requires a non-empty value");
          adminToken = trimmed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) throw new Error(`unsupported policy.bundle argument '${arg}'`);
        throw new Error(`unexpected policy.bundle argument '${arg}'`);
      }
      return { kind: "policy_bundle", admin_token: adminToken };
    }

    if (second === "overrides") {
      const third = argv[2];
      if (third === "-h" || third === "--help") return { kind: "help" };
      if (!third) throw new Error("policy overrides requires a subcommand (list|create|revoke)");

      if (third === "list") {
        let adminToken: string | undefined;
        for (let i = 3; i < argv.length; i += 1) {
          const arg = argv[i];
          if (!arg) continue;

          if (arg === "--admin-token") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--admin-token requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--admin-token requires a non-empty value");
            adminToken = trimmed;
            i += 1;
            continue;
          }

          if (arg === "-h" || arg === "--help") return { kind: "help" };
          if (arg.startsWith("-")) {
            throw new Error(`unsupported policy.overrides.list argument '${arg}'`);
          }
          throw new Error(`unexpected policy.overrides.list argument '${arg}'`);
        }
        return { kind: "policy_overrides_list", admin_token: adminToken };
      }

      if (third === "create") {
        let adminToken: string | undefined;
        let agentId: string | undefined;
        let toolId: string | undefined;
        let pattern: string | undefined;
        let workspaceId: string | undefined;

        for (let i = 3; i < argv.length; i += 1) {
          const arg = argv[i];
          if (!arg) continue;

          if (arg === "--admin-token") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--admin-token requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--admin-token requires a non-empty value");
            adminToken = trimmed;
            i += 1;
            continue;
          }

          if (arg === "--agent-id") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--agent-id requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--agent-id requires a non-empty value");
            agentId = trimmed;
            i += 1;
            continue;
          }

          if (arg === "--tool-id") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--tool-id requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--tool-id requires a non-empty value");
            toolId = trimmed;
            i += 1;
            continue;
          }

          if (arg === "--pattern") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--pattern requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--pattern requires a non-empty value");
            pattern = trimmed;
            i += 1;
            continue;
          }

          if (arg === "--workspace-id") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--workspace-id requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--workspace-id requires a non-empty value");
            workspaceId = trimmed;
            i += 1;
            continue;
          }

          if (arg === "-h" || arg === "--help") return { kind: "help" };

          if (arg.startsWith("-")) {
            throw new Error(`unsupported policy.overrides.create argument '${arg}'`);
          }
          throw new Error(`unexpected policy.overrides.create argument '${arg}'`);
        }

        if (!agentId) throw new Error("policy overrides create requires --agent-id <agent-id>");
        if (!toolId) throw new Error("policy overrides create requires --tool-id <tool-id>");
        if (!pattern) throw new Error("policy overrides create requires --pattern <glob>");

        return {
          kind: "policy_overrides_create",
          admin_token: adminToken,
          agent_id: agentId,
          tool_id: toolId,
          pattern,
          workspace_id: workspaceId,
        };
      }

      if (third === "revoke") {
        let adminToken: string | undefined;
        let id: string | undefined;
        let reason: string | undefined;

        for (let i = 3; i < argv.length; i += 1) {
          const arg = argv[i];
          if (!arg) continue;

          if (arg === "--admin-token") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--admin-token requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--admin-token requires a non-empty value");
            adminToken = trimmed;
            i += 1;
            continue;
          }

          if (arg === "--policy-override-id") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--policy-override-id requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--policy-override-id requires a non-empty value");
            id = trimmed;
            i += 1;
            continue;
          }

          if (arg === "--reason") {
            const raw = argv[i + 1];
            if (!raw) throw new Error("--reason requires a value");
            const trimmed = raw.trim();
            if (!trimmed) throw new Error("--reason requires a non-empty value");
            reason = trimmed;
            i += 1;
            continue;
          }

          if (arg === "-h" || arg === "--help") return { kind: "help" };

          if (arg.startsWith("-")) {
            throw new Error(`unsupported policy.overrides.revoke argument '${arg}'`);
          }
          throw new Error(`unexpected policy.overrides.revoke argument '${arg}'`);
        }

        if (!id) throw new Error("policy overrides revoke requires --policy-override-id <id>");
        return {
          kind: "policy_overrides_revoke",
          admin_token: adminToken,
          policy_override_id: id,
          reason,
        };
      }

      throw new Error(`unknown policy overrides subcommand '${third}'`);
    }

    throw new Error(`unknown policy subcommand '${second}'`);
  }

  if (first === "workflow") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second) {
      throw new Error("workflow requires a subcommand (run|resume|cancel)");
    }

    if (second === "run") {
      let key: string | undefined;
      let lane: WorkflowLane = "main";
      let stepsRaw: string | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--key") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--key requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--key requires a non-empty value");
          key = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--lane") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--lane requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--lane requires a non-empty value");
          if (!isWorkflowLane(trimmed)) {
            throw new Error(`--lane must be one of ${WORKFLOW_LANES.join(", ")}`);
          }
          lane = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--steps") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--steps requires a value");
          stepsRaw = raw;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported workflow.run argument '${arg}'`);
        }
        throw new Error(`unexpected workflow.run argument '${arg}'`);
      }

      if (!key) throw new Error("workflow run requires --key <key>");
      if (!stepsRaw) throw new Error("workflow run requires --steps <json>");

      let parsedSteps: unknown;
      try {
        parsedSteps = JSON.parse(stepsRaw) as unknown;
      } catch {
        throw new Error("--steps must be valid JSON");
      }
      if (!Array.isArray(parsedSteps)) {
        throw new Error("--steps must be a JSON array");
      }

      const normalizedSteps: ActionPrimitive[] = parsedSteps.map((rawStep, idx) => {
        if (typeof rawStep !== "object" || rawStep === null || Array.isArray(rawStep)) {
          throw new Error(`--steps[${String(idx)}] must be an object`);
        }
        const record = rawStep as Record<string, unknown>;
        const rawType = record["type"];
        if (typeof rawType !== "string") {
          throw new Error(`--steps[${String(idx)}].type must be a string`);
        }
        const type = rawType.trim();
        if (!type) {
          throw new Error(`--steps[${String(idx)}].type must be a non-empty string`);
        }

        let args: Record<string, unknown> = {};
        const rawArgs = record["args"];
        if (rawArgs !== undefined) {
          if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
            throw new Error(`--steps[${String(idx)}].args must be an object`);
          }
          args = rawArgs as Record<string, unknown>;
        }

        const rawKey = record["idempotency_key"];
        let idempotencyKey: string | undefined;
        if (rawKey !== undefined) {
          if (typeof rawKey !== "string") {
            throw new Error(`--steps[${String(idx)}].idempotency_key must be a string`);
          }
          const trimmed = rawKey.trim();
          if (!trimmed) {
            throw new Error(`--steps[${String(idx)}].idempotency_key must be a non-empty string`);
          }
          idempotencyKey = trimmed;
        }

        const step: ActionPrimitive = {
          type: type as ActionPrimitive["type"],
          args,
          ...(record["postcondition"] !== undefined
            ? { postcondition: record["postcondition"] }
            : {}),
          ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
        };
        return step;
      });

      if (normalizedSteps.length === 0) {
        throw new Error("--steps must be a non-empty JSON array");
      }

      return { kind: "workflow_run", key, lane, steps: normalizedSteps };
    }

    if (second === "resume") {
      let token: string | undefined;
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--token") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--token requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--token requires a non-empty value");
          token = trimmed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported workflow.resume argument '${arg}'`);
        }
        throw new Error(`unexpected workflow.resume argument '${arg}'`);
      }

      if (!token) throw new Error("workflow resume requires --token <resume-token>");
      return { kind: "workflow_resume", token };
    }

    if (second === "cancel") {
      let runId: string | undefined;
      let reason: string | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--run-id") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--run-id requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--run-id requires a non-empty value");
          runId = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--reason") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--reason requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--reason requires a non-empty value");
          reason = trimmed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported workflow.cancel argument '${arg}'`);
        }
        throw new Error(`unexpected workflow.cancel argument '${arg}'`);
      }

      if (!runId) throw new Error("workflow cancel requires --run-id <run-id>");
      return { kind: "workflow_cancel", run_id: runId, reason };
    }

    throw new Error(`unknown workflow subcommand '${second}'`);
  }

  if (first === "approvals") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (second && second !== "list" && second !== "resolve") {
      throw new Error(`unknown approvals subcommand '${second}'`);
    }

    if (!second || second === "list") {
      let limit = 100;
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--limit") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--limit requires a value");
          const parsed = Number.parseInt(raw, 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error("--limit must be a positive integer");
          }
          limit = parsed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported approvals.list argument '${arg}'`);
        }
        throw new Error(`unexpected approvals.list argument '${arg}'`);
      }

      return { kind: "approvals_list", limit };
    }

    let approvalId: number | undefined;
    let decision: "approved" | "denied" | undefined;
    let reason: string | undefined;

    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) continue;

      if (arg === "--approval-id") {
        const raw = argv[i + 1];
        if (!raw) throw new Error("--approval-id requires a value");
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--approval-id must be a positive integer");
        }
        approvalId = parsed;
        i += 1;
        continue;
      }

      if (arg === "--decision") {
        const raw = argv[i + 1]?.trim();
        if (!raw) throw new Error("--decision requires a value");
        if (raw !== "approved" && raw !== "denied") {
          throw new Error("--decision must be 'approved' or 'denied'");
        }
        decision = raw;
        i += 1;
        continue;
      }

      if (arg === "--reason") {
        const raw = argv[i + 1];
        if (!raw) throw new Error("--reason requires a value");
        const trimmed = raw.trim();
        if (!trimmed) throw new Error("--reason requires a non-empty value");
        reason = trimmed;
        i += 1;
        continue;
      }

      if (arg === "-h" || arg === "--help") return { kind: "help" };

      if (arg.startsWith("-")) {
        throw new Error(`unsupported approvals.resolve argument '${arg}'`);
      }
      throw new Error(`unexpected approvals.resolve argument '${arg}'`);
    }

    if (!approvalId) throw new Error("approvals resolve requires --approval-id <id>");
    if (!decision) throw new Error("approvals resolve requires --decision <approved|denied>");

    return { kind: "approvals_resolve", approval_id: approvalId, decision, reason };
  }

  if (first === "config") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second || second === "show") {
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;
        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) {
          throw new Error(`unsupported config.show argument '${arg}'`);
        }
        throw new Error(`unexpected config.show argument '${arg}'`);
      }
      return { kind: "config_show" };
    }
    if (second !== "set") {
      throw new Error(`unknown config subcommand '${second}'`);
    }

    let gatewayUrl: string | undefined;
    let token: string | undefined;
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) continue;

      if (arg === "--gateway-url") {
        gatewayUrl = argv[i + 1];
        i += 1;
        continue;
      }

      if (arg === "--token") {
        token = argv[i + 1];
        i += 1;
        continue;
      }

      if (arg === "-h" || arg === "--help") return { kind: "help" };

      if (arg.startsWith("-")) {
        throw new Error(`unsupported config.set argument '${arg}'`);
      }

      throw new Error(`unexpected config.set argument '${arg}'`);
    }

    const normalizedGatewayUrl = gatewayUrl?.trim();
    const normalizedToken = token?.trim();
    if (!normalizedGatewayUrl) throw new Error("config.set requires --gateway-url <url>");
    if (!normalizedToken) throw new Error("config.set requires --token <token>");

    return {
      kind: "config_set",
      gateway_url: normalizedGatewayUrl,
      auth_token: normalizedToken,
    };
  }

  if (first === "identity") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second || second === "show") {
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;
        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) {
          throw new Error(`unsupported identity.show argument '${arg}'`);
        }
        throw new Error(`unexpected identity.show argument '${arg}'`);
      }
      return { kind: "identity_show" };
    }
    if (second === "init") {
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;
        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) {
          throw new Error(`unsupported identity.init argument '${arg}'`);
        }
        throw new Error(`unexpected identity.init argument '${arg}'`);
      }
      return { kind: "identity_init" };
    }
    throw new Error(`unknown identity subcommand '${second}'`);
  }

  if (first === "admin-mode") {
    if (second === "-h" || second === "--help") return { kind: "help" };
    if (!second) throw new Error("admin-mode requires a subcommand (enter|status|exit)");

    if (second === "status") {
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;
        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) {
          throw new Error(`unsupported admin-mode.status argument '${arg}'`);
        }
        throw new Error(`unexpected admin-mode.status argument '${arg}'`);
      }
      return { kind: "admin_mode_status" };
    }

    if (second === "exit") {
      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;
        if (arg === "-h" || arg === "--help") return { kind: "help" };
        if (arg.startsWith("-")) {
          throw new Error(`unsupported admin-mode.exit argument '${arg}'`);
        }
        throw new Error(`unexpected admin-mode.exit argument '${arg}'`);
      }
      return { kind: "admin_mode_exit" };
    }

    if (second === "enter") {
      let adminToken: string | undefined;
      let ttlSeconds: number | undefined;

      for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg) continue;

        if (arg === "--admin-token") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--admin-token requires a value");
          const trimmed = raw.trim();
          if (!trimmed) throw new Error("--admin-token requires a non-empty value");
          adminToken = trimmed;
          i += 1;
          continue;
        }

        if (arg === "--ttl-seconds") {
          const raw = argv[i + 1];
          if (!raw) throw new Error("--ttl-seconds requires a value");
          const parsed = Number.parseInt(raw, 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error("--ttl-seconds must be a positive integer");
          }
          ttlSeconds = parsed;
          i += 1;
          continue;
        }

        if (arg === "-h" || arg === "--help") return { kind: "help" };

        if (arg.startsWith("-")) {
          throw new Error(`unsupported admin-mode.enter argument '${arg}'`);
        }
        throw new Error(`unexpected admin-mode.enter argument '${arg}'`);
      }

      if (!adminToken) throw new Error("admin-mode enter requires --admin-token <token>");

      return { kind: "admin_mode_enter", admin_token: adminToken, ttl_seconds: ttlSeconds };
    }

    throw new Error(`unknown admin-mode subcommand '${second}'`);
  }

  throw new Error(`unknown command '${first}'`);
}

async function loadOperatorConfig(path: string): Promise<{
  gateway_url?: string;
  auth_token?: string;
}> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("config file must be a JSON object");
    }
    const asRecord = parsed as Record<string, unknown>;
    const gatewayUrl =
      typeof asRecord.gateway_url === "string" ? asRecord.gateway_url.trim() : undefined;
    const authToken =
      typeof asRecord.auth_token === "string" ? asRecord.auth_token.trim() : undefined;
    return { gateway_url: gatewayUrl, auth_token: authToken };
  } catch (error) {
    const asErr = error as NodeJS.ErrnoException;
    if (asErr?.code === "ENOENT") return {};
    throw error;
  }
}

async function saveOperatorConfig(
  path: string,
  config: { gateway_url: string; auth_token: string },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

type PersistedAdminModeState = {
  elevatedToken: string;
  expiresAt: string;
};

function requireIsoDateTimeMs(raw: string, label: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be a valid ISO datetime string`);
  }
  return ms;
}

function formatRemainingMs(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

async function loadOperatorAdminModeState(path: string): Promise<PersistedAdminModeState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const asErr = error as NodeJS.ErrnoException;
    if (asErr?.code === "ENOENT") return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`admin mode state must be valid JSON: path=${path}`, { cause: error });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`admin mode state must be a JSON object: path=${path}`);
  }

  const record = parsed as Record<string, unknown>;
  const elevatedToken = typeof record.elevatedToken === "string" ? record.elevatedToken.trim() : "";
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt.trim() : "";
  if (!elevatedToken || !expiresAt) {
    throw new Error(`admin mode state missing elevatedToken/expiresAt: path=${path}`);
  }

  const expiresAtMs = requireIsoDateTimeMs(expiresAt, "admin mode expiresAt");
  if (expiresAtMs <= Date.now()) {
    await rm(path, { force: true });
    return null;
  }

  return { elevatedToken, expiresAt };
}

async function saveOperatorAdminModeState(
  path: string,
  state: PersistedAdminModeState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function clearOperatorAdminModeState(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function requireAdminModeToken(home: string, override: string | undefined): Promise<string> {
  const explicit = override?.trim();
  if (explicit) return explicit;

  const statePath = resolveOperatorAdminModePath(home);
  const state = await loadOperatorAdminModeState(statePath);
  if (state) return state.elevatedToken;

  throw new Error(
    "Admin Mode required: run 'tyrum-cli admin-mode enter --admin-token <token>' " +
      "or pass --admin-token <token> explicitly for this command.",
  );
}

async function requireOperatorConfig(
  home: string,
): Promise<{ gateway_url: string; auth_token: string }> {
  const configPath = resolveOperatorConfigPath(home);
  const config = await loadOperatorConfig(configPath);
  const gatewayUrl = config.gateway_url?.trim();
  const authToken = config.auth_token?.trim();
  if (!gatewayUrl || !authToken) {
    throw new Error(
      `operator config is missing gateway_url/token: run 'tyrum-cli config set --gateway-url <url> --token <token>' path=${configPath}`,
    );
  }
  return { gateway_url: gatewayUrl, auth_token: authToken };
}

async function requireOperatorDeviceIdentity(home: string): Promise<{
  deviceId: string;
  publicKey: string;
  privateKey: string;
}> {
  const identityPath = resolveOperatorDeviceIdentityPath(home);
  const storage = createNodeFileDeviceIdentityStorage(identityPath);
  const identity = await storage.load();
  if (!identity) {
    throw new Error(`device identity missing: run 'tyrum-cli identity init' path=${identityPath}`);
  }
  return identity;
}

async function withWsClient<T>(
  opts: ConstructorParameters<typeof TyrumClient>[0],
  fn: (client: TyrumClient) => Promise<T>,
): Promise<T> {
  const client = new TyrumClient(opts);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("WebSocket connect timed out"));
      }, 10_000);

      const cleanup = (): void => {
        clearTimeout(timer);
        client.off("connected", onConnected);
        client.off("transport_error", onTransportError);
        client.off("disconnected", onDisconnected);
      };

      const onConnected = (): void => {
        cleanup();
        resolve();
      };
      const onTransportError = (evt: { message: string }): void => {
        cleanup();
        reject(new Error(evt.message));
      };
      const onDisconnected = (evt: { code: number; reason: string }): void => {
        cleanup();
        reject(new Error(`WebSocket disconnected (${String(evt.code)}): ${evt.reason}`));
      };

      client.on("connected", onConnected);
      client.on("transport_error", onTransportError);
      client.on("disconnected", onDisconnected);
      client.connect();
    });
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

async function runOperatorWsCommand<T>(
  home: string,
  label: string,
  fn: (client: TyrumClient) => Promise<T>,
): Promise<number> {
  try {
    const config = await requireOperatorConfig(home);
    const identity = await requireOperatorDeviceIdentity(home);
    const wsUrl = resolveGatewayWsUrl(config.gateway_url);
    const result = await withWsClient(
      {
        url: wsUrl,
        token: config.auth_token,
        reconnect: false,
        capabilities: ["cli"],
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
        },
      },
      fn,
    );
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${label}: failed: ${message}`);
    return 1;
  }
}

type TyrumHttpClient = ReturnType<typeof createTyrumHttpClient>;

async function runOperatorHttpCommand<T>(
  home: string,
  label: string,
  fn: (http: TyrumHttpClient) => Promise<T>,
  opts?: { token?: string },
): Promise<number> {
  try {
    const config = await requireOperatorConfig(home);
    const token = (opts?.token ?? config.auth_token).trim();
    const http = createTyrumHttpClient({
      baseUrl: config.gateway_url,
      auth: { type: "bearer", token },
    });
    const result = await fn(http);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof TyrumHttpClientError) {
      const status = error.status ? `status=${String(error.status)}` : "status=unknown";
      console.error(`${label}: failed: ${status} message=${error.message}`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${label}: failed: ${message}`);
    return 1;
  }
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  let command: CliCommand;
  try {
    command = parseCliArgs(normalizedArgv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    printCliHelp();
    return 1;
  }

  if (command.kind === "help") {
    printCliHelp();
    return 0;
  }

  if (command.kind === "version") {
    console.log(VERSION);
    return 0;
  }

  const tyrumHome = resolveTyrumHome();

  if (command.kind === "admin_mode_status") {
    try {
      const statePath = resolveOperatorAdminModePath(tyrumHome);
      const state = await loadOperatorAdminModeState(statePath);
      if (!state) {
        console.log("admin-mode: inactive");
        return 0;
      }
      const expiresAtMs = requireIsoDateTimeMs(state.expiresAt, "admin mode expiresAt");
      const remainingMs = Math.max(0, expiresAtMs - Date.now());
      console.log(
        `admin-mode: active remaining=${formatRemainingMs(remainingMs)} expires_at=${state.expiresAt}`,
      );
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`admin-mode.status: failed: ${message}`);
      return 1;
    }
  }

  if (command.kind === "admin_mode_exit") {
    try {
      const statePath = resolveOperatorAdminModePath(tyrumHome);
      await clearOperatorAdminModeState(statePath);
      console.log("admin-mode.exit: ok");
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`admin-mode.exit: failed: ${message}`);
      return 1;
    }
  }

  if (command.kind === "admin_mode_enter") {
    try {
      const config = await requireOperatorConfig(tyrumHome);
      const http = createTyrumHttpClient({
        baseUrl: config.gateway_url,
        auth: { type: "bearer", token: command.admin_token },
      });

      const issued = await http.deviceTokens.issue({
        device_id: "operator-cli",
        role: "client",
        scopes: ["operator.admin"],
        ttl_seconds: command.ttl_seconds ?? 60 * 10,
      });

      const statePath = resolveOperatorAdminModePath(tyrumHome);
      await saveOperatorAdminModeState(statePath, {
        elevatedToken: issued.token,
        expiresAt: issued.expires_at,
      });

      console.log(`admin-mode.enter: ok expires_at=${issued.expires_at}`);
      return 0;
    } catch (error) {
      if (error instanceof TyrumHttpClientError) {
        const status = error.status ? `status=${String(error.status)}` : "status=unknown";
        console.error(`admin-mode.enter: failed: ${status} message=${error.message}`);
        return 1;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`admin-mode.enter: failed: ${message}`);
      return 1;
    }
  }

  if (
    command.kind === "policy_bundle" ||
    command.kind === "policy_overrides_list" ||
    command.kind === "policy_overrides_create" ||
    command.kind === "policy_overrides_revoke"
  ) {
    let token: string;
    try {
      token = await requireAdminModeToken(tyrumHome, command.admin_token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`policy: failed: ${message}`);
      return 1;
    }

    return await runOperatorHttpCommand(
      tyrumHome,
      "policy",
      async (http) => {
        switch (command.kind) {
          case "policy_bundle":
            return await http.policy.getBundle();
          case "policy_overrides_list":
            return await http.policy.listOverrides();
          case "policy_overrides_create":
            return await http.policy.createOverride({
              agent_id: command.agent_id,
              tool_id: command.tool_id,
              pattern: command.pattern,
              workspace_id: command.workspace_id,
            });
          case "policy_overrides_revoke":
            return await http.policy.revokeOverride({
              policy_override_id: command.policy_override_id,
              reason: command.reason,
            });
        }
      },
      { token },
    );
  }

  if (
    command.kind === "secrets_list" ||
    command.kind === "secrets_store" ||
    command.kind === "secrets_revoke" ||
    command.kind === "secrets_rotate"
  ) {
    let token: string;
    try {
      token = await requireAdminModeToken(tyrumHome, command.admin_token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`secrets: failed: ${message}`);
      return 1;
    }

    return await runOperatorHttpCommand(
      tyrumHome,
      "secrets",
      async (http) => {
        switch (command.kind) {
          case "secrets_list":
            return await http.secrets.list();
          case "secrets_store":
            return await http.secrets.store({
              scope: command.scope,
              provider: command.provider,
              value: command.value,
            });
          case "secrets_revoke":
            return await http.secrets.revoke(command.handle_id);
          case "secrets_rotate":
            return await http.secrets.rotate(command.handle_id, { value: command.value });
        }
      },
      { token },
    );
  }

  if (
    command.kind === "pairing_approve" ||
    command.kind === "pairing_deny" ||
    command.kind === "pairing_revoke"
  ) {
    return await runOperatorHttpCommand(tyrumHome, "pairing", async (http) => {
      switch (command.kind) {
        case "pairing_approve":
          return await http.pairings.approve(command.pairing_id, {
            trust_level: command.trust_level,
            capability_allowlist: command.capability_allowlist,
            reason: command.reason,
          });
        case "pairing_deny":
          return await http.pairings.deny(command.pairing_id, { reason: command.reason });
        case "pairing_revoke":
          return await http.pairings.revoke(command.pairing_id, { reason: command.reason });
      }
    });
  }

  if (command.kind === "approvals_list") {
    return await runOperatorWsCommand(tyrumHome, "approvals.list", async (client) => {
      return await client.approvalList({ limit: command.limit });
    });
  }

  if (command.kind === "approvals_resolve") {
    return await runOperatorWsCommand(tyrumHome, "approvals.resolve", async (client) => {
      return await client.approvalResolve({
        approval_id: command.approval_id,
        decision: command.decision,
        reason: command.reason,
      });
    });
  }

  if (command.kind === "workflow_run") {
    return await runOperatorWsCommand(tyrumHome, "workflow.run", async (client) => {
      return await client.workflowRun({
        key: command.key,
        lane: command.lane,
        steps: command.steps,
      });
    });
  }

  if (command.kind === "workflow_resume") {
    return await runOperatorWsCommand(tyrumHome, "workflow.resume", async (client) => {
      return await client.workflowResume({ token: command.token });
    });
  }

  if (command.kind === "workflow_cancel") {
    return await runOperatorWsCommand(tyrumHome, "workflow.cancel", async (client) => {
      return await client.workflowCancel({ run_id: command.run_id, reason: command.reason });
    });
  }

  if (command.kind === "config_show") {
    try {
      const configPath = resolveOperatorConfigPath(tyrumHome);
      const config = await loadOperatorConfig(configPath);
      const maskedToken = config.auth_token ? "[set]" : "[unset]";
      console.log(
        [
          "operator config",
          `home=${tyrumHome}`,
          `gateway_url=${config.gateway_url ?? "[unset]"}`,
          `auth_token=${maskedToken}`,
        ].join(" "),
      );
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`config.show: failed: ${message}`);
      return 1;
    }
  }

  if (command.kind === "config_set") {
    try {
      const configPath = resolveOperatorConfigPath(tyrumHome);
      await saveOperatorConfig(configPath, {
        gateway_url: command.gateway_url,
        auth_token: command.auth_token,
      });
      console.log(`config.set: ok path=${configPath}`);
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`config.set: failed: ${message}`);
      return 1;
    }
  }

  if (command.kind === "identity_show") {
    const identityPath = resolveOperatorDeviceIdentityPath(tyrumHome);
    const storage = createNodeFileDeviceIdentityStorage(identityPath);
    try {
      const identity = await storage.load();
      if (!identity) {
        console.error(`identity: not found: run 'tyrum-cli identity init' path=${identityPath}`);
        return 1;
      }
      console.log(`identity: ok device_id=${identity.deviceId} path=${identityPath}`);
      return 0;
    } catch (error) {
      console.error(`identity: failed: ${formatDeviceIdentityError(error)}`);
      return 1;
    }
  }

  if (command.kind === "identity_init") {
    const identityPath = resolveOperatorDeviceIdentityPath(tyrumHome);
    const storage = createNodeFileDeviceIdentityStorage(identityPath);
    try {
      const identity = await loadOrCreateDeviceIdentity(storage);
      console.log(`identity: ok device_id=${identity.deviceId} path=${identityPath}`);
      return 0;
    } catch (error) {
      console.error(`identity: failed: ${formatDeviceIdentityError(error)}`);
      return 1;
    }
  }

  return 1;
}
