import type { CliCommand } from "./cli-command.js";
import { printCliHelp } from "./cli-help.js";
import { resolveTyrumHome } from "./operator-paths.js";
import { VERSION } from "./version.js";

import { handleApprovalsList, handleApprovalsResolve } from "./handlers/approvals.js";
import { handleConfigSet, handleConfigShow } from "./handlers/config.js";
import {
  handleElevatedModeEnter,
  handleElevatedModeExit,
  handleElevatedModeStatus,
} from "./handlers/elevated-mode.js";
import { handleIdentityInit, handleIdentityShow } from "./handlers/identity.js";
import {
  handleMemoryCreate,
  handleMemoryDelete,
  handleMemoryExport,
  handleMemoryForget,
  handleMemoryList,
  handleMemoryRead,
  handleMemorySearch,
  handleMemoryUpdate,
} from "./handlers/memory.js";
import {
  handlePairingApprove,
  handlePairingDeny,
  handlePairingRevoke,
} from "./handlers/pairing.js";
import {
  handlePolicyBundle,
  handlePolicyOverridesCreate,
  handlePolicyOverridesList,
  handlePolicyOverridesRevoke,
} from "./handlers/policy.js";
import {
  handleSecretsList,
  handleSecretsRevoke,
  handleSecretsRotate,
  handleSecretsStore,
} from "./handlers/secrets.js";
import {
  handleWorkflowCancel,
  handleWorkflowResume,
  handleWorkflowRun,
} from "./handlers/workflow.js";
import { parseCliArgs } from "./parse/index.js";

type CliHandler<K extends CliCommand["kind"]> = (
  command: Extract<CliCommand, { kind: K }>,
  home: string,
) => Promise<number>;

type CliHandlers = { [K in CliCommand["kind"]]: CliHandler<K> };

const commandHandlers: CliHandlers = {
  help: async () => {
    printCliHelp();
    return 0;
  },
  version: async () => {
    console.log(VERSION);
    return 0;
  },
  elevated_mode_status: handleElevatedModeStatus,
  elevated_mode_exit: handleElevatedModeExit,
  elevated_mode_enter: handleElevatedModeEnter,
  policy_bundle: handlePolicyBundle,
  policy_overrides_list: handlePolicyOverridesList,
  policy_overrides_create: handlePolicyOverridesCreate,
  policy_overrides_revoke: handlePolicyOverridesRevoke,
  secrets_list: handleSecretsList,
  secrets_store: handleSecretsStore,
  secrets_revoke: handleSecretsRevoke,
  secrets_rotate: handleSecretsRotate,
  pairing_approve: handlePairingApprove,
  pairing_deny: handlePairingDeny,
  pairing_revoke: handlePairingRevoke,
  approvals_list: handleApprovalsList,
  approvals_resolve: handleApprovalsResolve,
  workflow_run: handleWorkflowRun,
  workflow_resume: handleWorkflowResume,
  workflow_cancel: handleWorkflowCancel,
  memory_search: handleMemorySearch,
  memory_list: handleMemoryList,
  memory_read: handleMemoryRead,
  memory_create: handleMemoryCreate,
  memory_update: handleMemoryUpdate,
  memory_delete: handleMemoryDelete,
  memory_forget: handleMemoryForget,
  memory_export: handleMemoryExport,
  config_show: handleConfigShow,
  config_set: handleConfigSet,
  identity_show: handleIdentityShow,
  identity_init: handleIdentityInit,
};

function dispatchCommand<K extends CliCommand["kind"]>(
  command: Extract<CliCommand, { kind: K }>,
  home: string,
): Promise<number> {
  return commandHandlers[command.kind](command, home);
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

  const home = resolveTyrumHome();
  return await dispatchCommand(command, home);
}
