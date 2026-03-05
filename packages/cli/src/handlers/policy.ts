import type { CliCommand } from "../cli-command.js";
import { runOperatorHttpCommand } from "../operator-clients.js";
import { requireElevatedModeToken } from "../operator-state.js";

export async function handlePolicyBundle(
  command: Extract<CliCommand, { kind: "policy_bundle" }>,
  home: string,
): Promise<number> {
  return await handlePolicyCommand(command, home);
}

export async function handlePolicyOverridesList(
  command: Extract<CliCommand, { kind: "policy_overrides_list" }>,
  home: string,
): Promise<number> {
  return await handlePolicyCommand(command, home);
}

export async function handlePolicyOverridesCreate(
  command: Extract<CliCommand, { kind: "policy_overrides_create" }>,
  home: string,
): Promise<number> {
  return await handlePolicyCommand(command, home);
}

export async function handlePolicyOverridesRevoke(
  command: Extract<CliCommand, { kind: "policy_overrides_revoke" }>,
  home: string,
): Promise<number> {
  return await handlePolicyCommand(command, home);
}

async function handlePolicyCommand(
  command:
    | Extract<CliCommand, { kind: "policy_bundle" }>
    | Extract<CliCommand, { kind: "policy_overrides_list" }>
    | Extract<CliCommand, { kind: "policy_overrides_create" }>
    | Extract<CliCommand, { kind: "policy_overrides_revoke" }>,
  home: string,
): Promise<number> {
  let token: string;
  try {
    token = await requireElevatedModeToken(home, command.elevated_token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`policy: failed: ${message}`);
    return 1;
  }

  return await runOperatorHttpCommand(
    home,
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
