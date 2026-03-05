import type { CliCommand } from "../cli-command.js";
import { runOperatorHttpCommand } from "../operator-clients.js";
import { requireElevatedModeToken } from "../operator-state.js";

export async function handleSecretsList(
  command: Extract<CliCommand, { kind: "secrets_list" }>,
  home: string,
): Promise<number> {
  return await handleSecretsCommand(command, home);
}

export async function handleSecretsStore(
  command: Extract<CliCommand, { kind: "secrets_store" }>,
  home: string,
): Promise<number> {
  return await handleSecretsCommand(command, home);
}

export async function handleSecretsRevoke(
  command: Extract<CliCommand, { kind: "secrets_revoke" }>,
  home: string,
): Promise<number> {
  return await handleSecretsCommand(command, home);
}

export async function handleSecretsRotate(
  command: Extract<CliCommand, { kind: "secrets_rotate" }>,
  home: string,
): Promise<number> {
  return await handleSecretsCommand(command, home);
}

async function handleSecretsCommand(
  command:
    | Extract<CliCommand, { kind: "secrets_list" }>
    | Extract<CliCommand, { kind: "secrets_store" }>
    | Extract<CliCommand, { kind: "secrets_revoke" }>
    | Extract<CliCommand, { kind: "secrets_rotate" }>,
  home: string,
): Promise<number> {
  let token: string;
  try {
    token = await requireElevatedModeToken(home, command.elevated_token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`secrets: failed: ${message}`);
    return 1;
  }

  return await runOperatorHttpCommand(
    home,
    "secrets",
    async (http) => {
      switch (command.kind) {
        case "secrets_list":
          return await http.secrets.list();
        case "secrets_store":
          return await http.secrets.store({
            secret_key: command.secret_key,
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
