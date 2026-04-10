import { Hono } from "hono";
import type { AppOptions } from "./app.js";
import type { GatewayContainer } from "./container.js";
import type { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import type { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import type {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "./modules/desktop-environments/dal.js";
import type { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import type { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import type { ConversationProviderPinDal } from "./modules/models/conversation-pin-dal.js";
import type { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import type { WsEventDal } from "./modules/ws-event/dal.js";

export interface AppRouteDependencies {
  authProfileDal: AuthProfileDal;
  pinDal: ConversationProviderPinDal;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
  routingConfigDal: RoutingConfigDal;
  channelThreadDal: ChannelThreadDal;
  wsEventDal: WsEventDal;
  desktopEnvironmentDal: DesktopEnvironmentDal;
  desktopEnvironmentHostDal: DesktopEnvironmentHostDal;
}

export interface AppRouteContext {
  app: Hono;
  container: GatewayContainer;
  opts: AppOptions;
  runtime: {
    version: string;
    instanceId: string;
    role: string;
    otelEnabled: boolean;
    desktopTakeoverAdvertiseOrigin?: string;
  };
  isLocalOnly: boolean;
  channelPipelineEnabled: boolean;
  wsMaxBufferedBytes?: number;
  workflowRunner: AppOptions["workflowRunner"];
  secretProviderForTenant: AppOptions["secretProviderForTenant"];
  routeDeps: AppRouteDependencies;
}
