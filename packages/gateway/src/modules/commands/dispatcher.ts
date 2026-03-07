import type { SqlDb, StateStoreKind } from "../../statestore/types.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { PresenceDal } from "../presence/dal.js";
import type { NodePairingDal } from "../node/pairing-dal.js";
import type { PolicyService } from "../policy/service.js";
import type { PolicyOverrideDal } from "../policy/override-dal.js";
import type { ContextReportDal } from "../context/report-dal.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { PluginCatalogProvider } from "../plugins/catalog-provider.js";
import type { ModelsDevService } from "../models/models-dev-service.js";
import type { ModelCatalogService } from "../models/model-catalog-service.js";
import type { AgentRegistry } from "../agent/registry.js";
import { tryExecuteAdminCommand } from "./dispatcher-admin-commands.js";
import { tryExecuteSessionCommand } from "./dispatcher-session-commands.js";
import { tryExecuteSystemCommand } from "./dispatcher-system-commands.js";
import { tokensFromCommand } from "./dispatcher-support.js";

export type CommandExecuteResult = {
  output: string;
  data?: unknown;
};

export interface CommandDeps {
  tenantId?: string;
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    dbKind: StateStoreKind;
    isExposed: boolean;
    otelEnabled: boolean;
  };
  commandContext?: {
    agentId?: string;
    channel?: string;
    threadId?: string;
    key?: string;
    lane?: string;
  };
  connectionManager?: ConnectionManager;
  db?: SqlDb;
  approvalDal?: ApprovalDal;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  policyService?: PolicyService;
  policyOverrideDal?: PolicyOverrideDal;
  contextReportDal?: ContextReportDal;
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
  modelsDev?: ModelsDevService;
  modelCatalog?: ModelCatalogService;
  agents?: AgentRegistry;
  fetchImpl?: typeof fetch;
}

export async function executeCommand(
  raw: string,
  deps: CommandDeps,
): Promise<CommandExecuteResult> {
  const toks = tokensFromCommand(raw);
  const cmd = toks[0]?.toLowerCase() ?? "help";

  const result =
    (await tryExecuteSystemCommand({ cmd, deps, toks })) ??
    (await tryExecuteAdminCommand({ cmd, deps, toks })) ??
    (await tryExecuteSessionCommand({ cmd, deps, toks }));
  if (result) return result;

  if (deps.tenantId && deps.pluginCatalogProvider) {
    const tenantPlugins = await deps.pluginCatalogProvider.loadTenantRegistry(deps.tenantId);
    const pluginResult = await tenantPlugins.tryExecuteCommand(raw);
    if (pluginResult) return pluginResult;
  }

  if (deps.plugins) {
    const pluginResult = await deps.plugins.tryExecuteCommand(raw);
    if (pluginResult) return pluginResult;
  }

  return { output: `Unknown command '${cmd}'. Try /help.`, data: null };
}
