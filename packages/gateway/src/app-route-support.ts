import type { GatewayContainer } from "./container.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { ConversationProviderPinDal } from "./modules/models/conversation-pin-dal.js";
import { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "./modules/desktop-environments/dal.js";
import { loadAllPlaybooks } from "./modules/playbook/loader.js";
import { PlaybookRunner } from "./modules/playbook/runner.js";
import { LocationService } from "./modules/location/service.js";
import { WsEventDal } from "./modules/ws-event/dal.js";
import type { AppRouteContext } from "./app-route-types.js";

export function createAppRouteDependencies(container: GatewayContainer) {
  return {
    authProfileDal: new AuthProfileDal(container.db),
    pinDal: new ConversationProviderPinDal(container.db),
    configuredModelPresetDal: new ConfiguredModelPresetDal(container.db),
    executionProfileModelAssignmentDal: new ExecutionProfileModelAssignmentDal(container.db),
    routingConfigDal: new RoutingConfigDal(container.db),
    channelThreadDal: new ChannelThreadDal(container.db),
    wsEventDal: new WsEventDal(container.db),
    desktopEnvironmentDal: new DesktopEnvironmentDal(container.db),
    desktopEnvironmentHostDal: new DesktopEnvironmentHostDal(container.db),
  };
}

export function createWsRouteOptions(context: AppRouteContext) {
  if (!context.opts.connectionManager) return undefined;

  return {
    connectionManager: context.opts.connectionManager,
    maxBufferedBytes: context.wsMaxBufferedBytes,
    cluster: context.opts.wsCluster,
  };
}

export function createClusterWsRouteOptions(context: AppRouteContext) {
  if (!context.opts.connectionManager) return undefined;

  return {
    connectionManager: context.opts.connectionManager,
    maxBufferedBytes: context.wsMaxBufferedBytes,
    cluster:
      context.opts.wsCluster && context.opts.connectionDirectory
        ? {
            ...context.opts.wsCluster,
            connectionDirectory: context.opts.connectionDirectory,
          }
        : undefined,
  };
}

function resolvePlaybooks(context: AppRouteContext) {
  const playbookHome = context.container.config?.tyrumHome;
  return (
    context.opts.playbooks ?? (playbookHome ? loadAllPlaybooks(`${playbookHome}/playbooks`) : [])
  );
}

export function createExecutionRouteServices(context: AppRouteContext) {
  const playbookRunner = new PlaybookRunner();
  const playbooks = resolvePlaybooks(context);
  const locationService = new LocationService(context.container.db, {
    identityScopeDal: context.container.identityScopeDal,
    memoryDal: context.container.memoryDal,
    policyService: context.container.policyService,
    playbooks,
    playbookRunner,
  });

  return { playbookRunner, playbooks, locationService };
}
