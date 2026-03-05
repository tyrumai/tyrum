import type { AuthTokenService } from "../../modules/auth/auth-token-service.js";
import type { SlidingWindowRateLimiter } from "../../modules/auth/rate-limiter.js";
import type { ConnectionDirectoryDal } from "../../modules/backplane/connection-directory.js";
import type { NodePairingDal } from "../../modules/node/pairing-dal.js";
import type { PresenceDal } from "../../modules/presence/dal.js";
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
  cluster?: WsClusterOptions;
  presence?: WsPresenceOptions;
}
