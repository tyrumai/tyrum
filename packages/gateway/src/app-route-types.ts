import type { Hono } from "hono";
import type { AppOptions } from "./app.js";
import type { GatewayContainer } from "./container.js";
import { AuthProfileDal } from "./modules/models/auth-profile-dal.js";
import { SessionProviderPinDal } from "./modules/models/session-pin-dal.js";
import { ConfiguredModelPresetDal } from "./modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "./modules/models/execution-profile-model-assignment-dal.js";
import { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import { RoutingConfigDal } from "./modules/channels/routing-config-dal.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "./modules/desktop-environments/dal.js";
import { WsEventDal } from "./modules/ws-event/dal.js";

export interface AppRouteDependencies {
  authProfileDal: AuthProfileDal;
  pinDal: SessionProviderPinDal;
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
  };
  isLocalOnly: boolean;
  wsMaxBufferedBytes?: number;
  channelPipelineEnabled: boolean;
  engine: AppOptions["engine"];
  secretProviderForTenant: AppOptions["secretProviderForTenant"];
  routeDeps: AppRouteDependencies;
}
