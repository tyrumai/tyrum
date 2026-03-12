import type { Playbook } from "@tyrum/schemas";
import type { AppOptions } from "./app.js";
import type { GatewayContainer } from "./container.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "./modules/models/session-pin-dal.js";
import { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import { WsEventDal } from "./modules/ws-event/dal.js";
import type { AppRouteDependencies } from "./app-route-types.js";

export function createAppRouteDependencies(container: GatewayContainer): AppRouteDependencies {
  return {
    authProfileDal: new AuthProfileDal(container.db),
    pinDal: new SessionProviderPinDal(container.db),
    configuredModelPresetDal: new ConfiguredModelPresetDal(container.db),
    executionProfileModelAssignmentDal: new ExecutionProfileModelAssignmentDal(container.db),
    routingConfigDal: new RoutingConfigDal(container.db),
    channelThreadDal: new ChannelThreadDal(container.db),
    wsEventDal: new WsEventDal(container.db),
  };
}

export function createWsRouteOptions(input: {
  connectionManager: AppOptions["connectionManager"];
  wsCluster: AppOptions["wsCluster"];
  wsMaxBufferedBytes?: number;
}) {
  if (!input.connectionManager) return undefined;

  return {
    connectionManager: input.connectionManager,
    maxBufferedBytes: input.wsMaxBufferedBytes,
    cluster: input.wsCluster,
  };
}

export function createClusterWsRouteOptions(input: {
  connectionDirectory: AppOptions["connectionDirectory"];
  connectionManager: AppOptions["connectionManager"];
  wsCluster: AppOptions["wsCluster"];
  wsMaxBufferedBytes?: number;
}) {
  if (!input.connectionManager) return undefined;

  return {
    connectionManager: input.connectionManager,
    maxBufferedBytes: input.wsMaxBufferedBytes,
    cluster:
      input.wsCluster && input.connectionDirectory
        ? {
            ...input.wsCluster,
            connectionDirectory: input.connectionDirectory,
          }
        : undefined,
  };
}

export function resolvePlaybooks(input: {
  playbooks: AppOptions["playbooks"];
  tyrumHome?: string;
}): Playbook[] {
  return (
    input.playbooks ?? (input.tyrumHome ? loadAllPlaybooks(`${input.tyrumHome}/playbooks`) : [])
  );
}
