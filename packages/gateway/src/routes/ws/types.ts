import type { AuthTokenService } from "../../app/modules/auth/auth-token-service.js";
import type { SlidingWindowRateLimiter } from "../../app/modules/auth/rate-limiter.js";
import type { ConnectionDirectoryDal } from "../../app/modules/backplane/connection-directory.js";
import type { DesktopEnvironmentDal } from "../../app/modules/desktop-environments/dal.js";
import type { NodePairingDal } from "../../app/modules/node/pairing-dal.js";
import type { PresenceDal } from "../../app/modules/presence/dal.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ProtocolDeps } from "../../ws/protocol.js";

export interface WsClusterOptions {
  instanceId: string;
  connectionDirectory: ConnectionDirectoryDal;
  connectionTtlMs?: number;
}

export interface WsPresenceOptions {
  ttlMs?: number;
  maxEntries?: number;
}

export interface WsRouteOptions {
  connectionManager: ConnectionManager;
  protocolDeps: ProtocolDeps;
  authTokens: AuthTokenService;
  trustedProxies?: string;
  upgradeRateLimiter?: SlidingWindowRateLimiter;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  desktopEnvironmentDal?: DesktopEnvironmentDal;
  cluster?: WsClusterOptions;
  presence?: WsPresenceOptions;
}
