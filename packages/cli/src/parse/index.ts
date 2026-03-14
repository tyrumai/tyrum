import { configureCommander } from "@tyrum/cli-utils";
import { Command } from "commander";
import { normalizeFingerprint256 } from "@tyrum/client/node";
import type { ActionPrimitive } from "@tyrum/client";
import type { CliCommand, WorkflowLane } from "../cli-command.js";
import { WORKFLOW_LANES, isWorkflowLane } from "../cli-command.js";
import { collectValues, normalizeArgv, normalizeCommanderError } from "./commander.js";

function parseNonEmptyString(raw: string | undefined, flag: string): string {
  if (!raw) throw new Error(`${flag} requires a value`);
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${flag} requires a non-empty value`);
  return trimmed;
}

function parseRequiredValue(raw: string | undefined, flag: string): string {
  if (!raw) throw new Error(`${flag} requires a value`);
  return raw;
}

function parsePositiveInt(raw: string | undefined, flag: string): number {
  if (!raw) throw new Error(`${flag} requires a value`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseElevatedToken(raw: string | undefined): string {
  return parseNonEmptyString(raw, "--elevated-token");
}

function parseWorkflowSteps(stepsRaw: string): ActionPrimitive[] {
  let parsedSteps: unknown;
  try {
    parsedSteps = JSON.parse(stepsRaw) as unknown;
  } catch {
    throw new Error("--steps must be valid JSON");
  }
  if (!Array.isArray(parsedSteps)) {
    throw new Error("--steps must be a JSON array");
  }

  return parsedSteps.map((rawStep, idx) => {
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

    const step: ActionPrimitive & { postcondition?: unknown; idempotency_key?: string } = {
      type: type as ActionPrimitive["type"],
      args,
    };
    if (record["postcondition"] !== undefined) {
      step.postcondition = record["postcondition"];
    }
    if (idempotencyKey !== undefined) {
      step.idempotency_key = idempotencyKey;
    }
    return step;
  });
}

function parseTrustLevel(value: string | undefined): "local" | "remote" {
  const trimmed = parseNonEmptyString(value, "--trust-level");
  if (trimmed !== "local" && trimmed !== "remote") {
    throw new Error("--trust-level must be 'local' or 'remote'");
  }
  return trimmed;
}

function parseDecision(value: string | undefined): "approved" | "denied" {
  const trimmed = parseNonEmptyString(value, "--decision");
  if (trimmed !== "approved" && trimmed !== "denied") {
    throw new Error("--decision must be 'approved' or 'denied'");
  }
  return trimmed;
}

function parseApprovalId(value: string | undefined): string {
  const trimmed = parseNonEmptyString(value, "--approval-id");
  const approvalIdRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!approvalIdRegex.test(trimmed)) {
    throw new Error("--approval-id must be a UUID");
  }
  return trimmed;
}

function parseCapabilities(values: string[]): Array<{ id: string; version: string }> {
  if (values.length === 0) {
    throw new Error("pairing approve requires at least one --capability <id[@version]>");
  }

  return values.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("--capability requires a non-empty value");
    const [id, versionRaw] = trimmed.split("@", 2);
    const capabilityId = id?.trim() ?? "";
    const version = versionRaw?.trim() || "1.0.0";
    if (!capabilityId) throw new Error("--capability requires a non-empty id");
    if (!version) throw new Error("--capability version must be non-empty");
    return { id: capabilityId, version };
  });
}

function parseLane(value: string | undefined): WorkflowLane {
  const lane = parseNonEmptyString(value, "--lane");
  if (!isWorkflowLane(lane)) {
    throw new Error(`--lane must be one of ${WORKFLOW_LANES.join(", ")}`);
  }
  return lane;
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "help" };
  if (argv.some((arg) => arg === "-h" || arg === "--help")) return { kind: "help" };
  if (argv[0] === "--version") return { kind: "version" };

  const normalizedArgv = normalizeArgv(argv);
  let result: CliCommand | undefined;

  const program = configureCommander(new Command().name("tyrum-cli"));

  const configCommand = program.command("config");
  configCommand
    .command("show")
    .allowExcessArguments(false)
    .action(() => {
      result = { kind: "config_show" };
    });

  configCommand
    .command("set")
    .allowExcessArguments(false)
    .option("--gateway-url <url>")
    .option("--token <token>")
    .option("--tls-fingerprint256 <hex>")
    .option("--tls-allow-self-signed")
    .action(
      (options: {
        gatewayUrl?: string;
        token?: string;
        tlsFingerprint256?: string;
        tlsAllowSelfSigned?: boolean;
      }) => {
        const gatewayUrl = parseNonEmptyString(options.gatewayUrl, "--gateway-url");
        const authToken = parseNonEmptyString(options.token, "--token");
        const tlsRaw = options.tlsFingerprint256?.trim() ?? "";
        const tlsCertFingerprint256 = tlsRaw.length > 0 ? normalizeFingerprint256(tlsRaw) : null;
        if (tlsRaw && !tlsCertFingerprint256) {
          throw new Error("--tls-fingerprint256 must be a SHA-256 hex fingerprint");
        }
        if (options.tlsAllowSelfSigned && !tlsCertFingerprint256) {
          throw new Error("--tls-allow-self-signed requires --tls-fingerprint256");
        }

        result = {
          kind: "config_set",
          gateway_url: gatewayUrl,
          auth_token: authToken,
          ...(tlsCertFingerprint256 ? { tls_cert_fingerprint256: tlsCertFingerprint256 } : {}),
          ...(options.tlsAllowSelfSigned ? { tls_allow_self_signed: true } : {}),
        };
      },
    );

  const identityCommand = program.command("identity");
  identityCommand
    .command("show")
    .allowExcessArguments(false)
    .action(() => {
      result = { kind: "identity_show" };
    });

  identityCommand
    .command("init")
    .allowExcessArguments(false)
    .action(() => {
      result = { kind: "identity_init" };
    });

  const elevatedModeCommand = program.command("elevated-mode");
  elevatedModeCommand
    .command("enter")
    .allowExcessArguments(false)
    .option("--ttl-seconds <seconds>")
    .action((options: { ttlSeconds?: string }) => {
      result = {
        kind: "elevated_mode_enter",
        ttl_seconds: options.ttlSeconds
          ? parsePositiveInt(options.ttlSeconds, "--ttl-seconds")
          : undefined,
      };
    });

  elevatedModeCommand
    .command("status")
    .allowExcessArguments(false)
    .action(() => {
      result = { kind: "elevated_mode_status" };
    });

  elevatedModeCommand
    .command("exit")
    .allowExcessArguments(false)
    .action(() => {
      result = { kind: "elevated_mode_exit" };
    });

  const approvalsCommand = program.command("approvals");
  approvalsCommand
    .command("list")
    .allowExcessArguments(false)
    .option("--limit <n>")
    .action((options: { limit?: string }) => {
      result = {
        kind: "approvals_list",
        limit: options.limit ? parsePositiveInt(options.limit, "--limit") : 100,
      };
    });

  approvalsCommand
    .command("resolve")
    .allowExcessArguments(false)
    .option("--approval-id <id>")
    .option("--decision <decision>")
    .option("--reason <text>")
    .action((options: { approvalId?: string; decision?: string; reason?: string }) => {
      result = {
        kind: "approvals_resolve",
        approval_id: parseApprovalId(options.approvalId),
        decision: parseDecision(options.decision),
        reason: options.reason ? parseNonEmptyString(options.reason, "--reason") : undefined,
      };
    });

  const workflowCommand = program.command("workflow");
  workflowCommand
    .command("run")
    .allowExcessArguments(false)
    .option("--key <key>")
    .option("--lane <lane>")
    .option("--steps <json>")
    .action((options: { key?: string; lane?: string; steps?: string }) => {
      const key = parseNonEmptyString(options.key, "--key");
      const stepsRaw = parseRequiredValue(options.steps, "--steps");
      const steps = parseWorkflowSteps(stepsRaw);
      if (steps.length === 0) {
        throw new Error("--steps must be a non-empty JSON array");
      }
      result = {
        kind: "workflow_run",
        key,
        lane: options.lane ? parseLane(options.lane) : "main",
        steps,
      };
    });

  workflowCommand
    .command("resume")
    .allowExcessArguments(false)
    .option("--token <token>")
    .action((options: { token?: string }) => {
      result = {
        kind: "workflow_resume",
        token: parseNonEmptyString(options.token, "--token"),
      };
    });

  workflowCommand
    .command("cancel")
    .allowExcessArguments(false)
    .option("--run-id <id>")
    .option("--reason <text>")
    .action((options: { runId?: string; reason?: string }) => {
      result = {
        kind: "workflow_cancel",
        run_id: parseNonEmptyString(options.runId, "--run-id"),
        reason: options.reason ? parseNonEmptyString(options.reason, "--reason") : undefined,
      };
    });

  const pairingCommand = program.command("pairing");
  pairingCommand
    .command("approve")
    .allowExcessArguments(false)
    .option("--pairing-id <id>")
    .option("--trust-level <level>")
    .option("--capability <id[@version]>", "", collectValues, [])
    .option("--reason <text>")
    .action(
      (options: {
        pairingId?: string;
        trustLevel?: string;
        capability: string[];
        reason?: string;
      }) => {
        result = {
          kind: "pairing_approve",
          pairing_id: parsePositiveInt(options.pairingId, "--pairing-id"),
          trust_level: parseTrustLevel(options.trustLevel),
          capability_allowlist: parseCapabilities(options.capability),
          reason: options.reason ? parseNonEmptyString(options.reason, "--reason") : undefined,
        };
      },
    );

  for (const commandName of ["deny", "revoke"] as const) {
    pairingCommand
      .command(commandName)
      .allowExcessArguments(false)
      .option("--pairing-id <id>")
      .option("--reason <text>")
      .action((options: { pairingId?: string; reason?: string }) => {
        result =
          commandName === "deny"
            ? {
                kind: "pairing_deny",
                pairing_id: parsePositiveInt(options.pairingId, "--pairing-id"),
                reason: options.reason
                  ? parseNonEmptyString(options.reason, "--reason")
                  : undefined,
              }
            : {
                kind: "pairing_revoke",
                pairing_id: parsePositiveInt(options.pairingId, "--pairing-id"),
                reason: options.reason
                  ? parseNonEmptyString(options.reason, "--reason")
                  : undefined,
              };
      });
  }

  const secretsCommand = program.command("secrets");
  secretsCommand
    .command("list")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .action((options: { elevatedToken?: string }) => {
      result = {
        kind: "secrets_list",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
      };
    });

  secretsCommand
    .command("store")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .option("--secret-key <key>")
    .option("--value <value>")
    .action((options: { elevatedToken?: string; secretKey?: string; value?: string }) => {
      result = {
        kind: "secrets_store",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
        secret_key: parseNonEmptyString(options.secretKey, "--secret-key"),
        value: parseRequiredValue(options.value, "--value"),
      };
    });

  secretsCommand
    .command("revoke")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .option("--handle-id <id>")
    .action((options: { elevatedToken?: string; handleId?: string }) => {
      result = {
        kind: "secrets_revoke",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
        handle_id: parseNonEmptyString(options.handleId, "--handle-id"),
      };
    });

  secretsCommand
    .command("rotate")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .option("--handle-id <id>")
    .option("--value <value>")
    .action((options: { elevatedToken?: string; handleId?: string; value?: string }) => {
      result = {
        kind: "secrets_rotate",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
        handle_id: parseNonEmptyString(options.handleId, "--handle-id"),
        value: parseRequiredValue(options.value, "--value"),
      };
    });

  const policyCommand = program.command("policy");
  policyCommand
    .command("bundle")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .action((options: { elevatedToken?: string }) => {
      result = {
        kind: "policy_bundle",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
      };
    });

  const policyOverridesCommand = policyCommand.command("overrides");
  policyOverridesCommand
    .command("list")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .action((options: { elevatedToken?: string }) => {
      result = {
        kind: "policy_overrides_list",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
      };
    });

  policyOverridesCommand
    .command("create")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .option("--agent-id <id>")
    .option("--tool-id <id>")
    .option("--pattern <glob>")
    .option("--workspace-id <id>")
    .action(
      (options: {
        elevatedToken?: string;
        agentId?: string;
        toolId?: string;
        pattern?: string;
        workspaceId?: string;
      }) => {
        result = {
          kind: "policy_overrides_create",
          elevated_token: options.elevatedToken
            ? parseElevatedToken(options.elevatedToken)
            : undefined,
          agent_id: parseNonEmptyString(options.agentId, "--agent-id"),
          tool_id: parseNonEmptyString(options.toolId, "--tool-id"),
          pattern: parseNonEmptyString(options.pattern, "--pattern"),
          workspace_id: options.workspaceId
            ? parseNonEmptyString(options.workspaceId, "--workspace-id")
            : undefined,
        };
      },
    );

  policyOverridesCommand
    .command("revoke")
    .allowExcessArguments(false)
    .option("--elevated-token <token>")
    .option("--policy-override-id <id>")
    .option("--reason <text>")
    .action((options: { elevatedToken?: string; policyOverrideId?: string; reason?: string }) => {
      result = {
        kind: "policy_overrides_revoke",
        elevated_token: options.elevatedToken
          ? parseElevatedToken(options.elevatedToken)
          : undefined,
        policy_override_id: parseNonEmptyString(options.policyOverrideId, "--policy-override-id"),
        reason: options.reason ? parseNonEmptyString(options.reason, "--reason") : undefined,
      };
    });

  try {
    program.parse(normalizedArgv, { from: "user" });
  } catch (error) {
    normalizeCommanderError(error);
  }

  if (!result) {
    throw new Error(`unknown command '${argv[0] ?? ""}'`);
  }

  return result;
}
