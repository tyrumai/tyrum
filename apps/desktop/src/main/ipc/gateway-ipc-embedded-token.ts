import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveGatewayBin } from "../gateway-bin-path.js";
import type { DesktopNodeConfig } from "../config/schema.js";
import { saveConfig } from "../config/store.js";
import { decryptToken, encryptToken } from "../config/token-store.js";
import type { GatewayManager } from "../gateway-manager.js";

export type EmbeddedGatewayTokenState = {
  current: string | null;
};

export type EmbeddedGatewayTokenRecoveryContext = "running" | "started";
type EmbeddedGatewayTokenFailure = "missing" | "decrypt" | "empty";
type EmbeddedGatewayTokenMessages = {
  missingTokenRefError: string;
  decryptWarn: string;
  decryptFailError: string;
  emptyTokenWarn: string;
  emptyTokenFailError: string;
};

export const EMBEDDED_GATEWAY_TOKEN_RECOVERY_MESSAGES: Record<
  EmbeddedGatewayTokenRecoveryContext,
  EmbeddedGatewayTokenMessages
> = {
  running: {
    missingTokenRefError:
      "Embedded gateway is running but no saved token is available. Restarting the embedded gateway will recover access automatically.",
    decryptWarn: "Failed to decrypt the saved embedded gateway token while the gateway is running.",
    decryptFailError:
      "Embedded gateway token could not be decrypted while the gateway is running. Restarting the embedded gateway will recover access automatically.",
    emptyTokenWarn: "Saved embedded gateway token was empty while the gateway is running.",
    emptyTokenFailError:
      "Embedded gateway token is empty while the gateway is running. Restarting the embedded gateway will recover access automatically.",
  },
  started: {
    missingTokenRefError:
      "Embedded gateway started but no saved token is available. Automatic recovery should recreate one.",
    decryptWarn: "Failed to decrypt the saved embedded gateway token after startup.",
    decryptFailError:
      "Embedded gateway token could not be decrypted after startup. Automatic recovery should recreate one.",
    emptyTokenWarn: "Saved embedded gateway token was empty after startup.",
    emptyTokenFailError:
      "Embedded gateway token is empty after startup. Automatic recovery should recreate one.",
  },
};

type EmbeddedGatewayRuntimeContext = {
  tyrumHome: string;
  dbPath: string;
  gatewayBin: ReturnType<typeof resolveGatewayBin>;
};

export function normalizeGatewayToken(token: string | undefined | null): string | null {
  const trimmed = token?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function ensureEmbeddedGatewayToken(
  config: DesktopNodeConfig,
  tokenState: EmbeddedGatewayTokenState,
): string {
  return resolveEmbeddedGatewayAccessTokenOrThrow(config, tokenState, {
    missingTokenRefError:
      "Embedded gateway token is missing. Start the embedded gateway from the Desktop app to recover it automatically.",
    decryptWarn: "Failed to decrypt the saved embedded gateway token.",
    decryptFailError:
      "Embedded gateway token could not be decrypted. Start the embedded gateway from the Desktop app to recover it automatically.",
    emptyTokenWarn: "Saved embedded gateway token was empty.",
    emptyTokenFailError:
      "Embedded gateway token is empty. Start the embedded gateway from the Desktop app to recover it automatically.",
  });
}

export function ensureEmbeddedGatewayTokenForRecoveryContext(
  config: DesktopNodeConfig,
  tokenState: EmbeddedGatewayTokenState,
  context: EmbeddedGatewayTokenRecoveryContext,
): string {
  return resolveEmbeddedGatewayAccessTokenOrThrow(
    config,
    tokenState,
    EMBEDDED_GATEWAY_TOKEN_RECOVERY_MESSAGES[context],
  );
}

export function captureEmbeddedBootstrapToken(
  mgr: GatewayManager,
  config: DesktopNodeConfig,
  tokenState: EmbeddedGatewayTokenState,
): string | undefined {
  const bootstrap = normalizeGatewayToken(mgr.getBootstrapToken("default-tenant-admin"));
  if (!bootstrap) return undefined;
  persistEmbeddedGatewayToken(config, bootstrap, tokenState);
  return bootstrap;
}

export function resolveEmbeddedGatewayRuntimeContext(
  config: DesktopNodeConfig,
): EmbeddedGatewayRuntimeContext {
  const tyrumHome = process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
  return {
    tyrumHome,
    dbPath: resolveEmbeddedGatewayDbPath(config, tyrumHome),
    gatewayBin: resolveGatewayBin(),
  };
}

export async function recoverEmbeddedGatewayAccessToken(
  config: DesktopNodeConfig,
  mgr: GatewayManager,
  runtimeContext: EmbeddedGatewayRuntimeContext,
  tokenState: EmbeddedGatewayTokenState,
): Promise<string> {
  const provisionedToken = resolveProvisionedGatewayToken();
  if (provisionedToken) {
    persistEmbeddedGatewayToken(config, provisionedToken, tokenState);
    return provisionedToken;
  }

  try {
    const issuedToken = await mgr.issueDefaultTenantAdminToken({
      gatewayBin: runtimeContext.gatewayBin.path,
      gatewayBinSource: runtimeContext.gatewayBin.source,
      dbPath: runtimeContext.dbPath,
      home: runtimeContext.tyrumHome,
    });
    persistEmbeddedGatewayToken(config, issuedToken, tokenState);
    return issuedToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Automatic embedded token recovery failed: ${message}`);
  }
}

function resolveProvisionedGatewayToken(): string | null {
  return normalizeGatewayToken(
    process.env["TYRUM_GATEWAY_TOKEN"] ?? process.env["GATEWAY_TOKEN"] ?? "",
  );
}

function persistEmbeddedGatewayToken(
  config: DesktopNodeConfig,
  token: string,
  tokenState: EmbeddedGatewayTokenState,
): void {
  const normalized = normalizeGatewayToken(token);
  if (!normalized) {
    throw new Error("Embedded gateway token must be non-empty.");
  }
  config.embedded.tokenRef = encryptToken(normalized);
  saveConfig(config);
  tokenState.current = normalized;
}

function resolveEmbeddedGatewayDbPath(config: DesktopNodeConfig, tyrumHome: string): string {
  const configured = config.embedded.dbPath.trim();
  if (configured) return configured;

  const currentPath = join(tyrumHome, "gateway.db");
  const legacyPath = join(tyrumHome, "gateway", "gateway.db");

  try {
    if (existsSync(currentPath)) return currentPath;
  } catch {
    // ignore
  }

  try {
    if (existsSync(legacyPath)) return legacyPath;
  } catch {
    // ignore
  }

  return currentPath;
}

function readStoredEmbeddedGatewayAccessToken(
  config: DesktopNodeConfig,
  tokenState: EmbeddedGatewayTokenState,
  messages: EmbeddedGatewayTokenMessages,
): { token: string | null; failure: EmbeddedGatewayTokenFailure | null } {
  if (tokenState.current) {
    return { token: tokenState.current, failure: null };
  }

  const tokenRef = config.embedded.tokenRef;
  if (!tokenRef) {
    return { token: null, failure: "missing" };
  }

  let decrypted: string;
  try {
    decrypted = decryptToken(tokenRef);
  } catch (error) {
    console.warn(messages.decryptWarn, error);
    return { token: null, failure: "decrypt" };
  }

  const normalized = normalizeGatewayToken(decrypted);
  if (!normalized) {
    console.warn(messages.emptyTokenWarn);
    return { token: null, failure: "empty" };
  }

  tokenState.current = normalized;
  return { token: normalized, failure: null };
}

function resolveEmbeddedGatewayAccessTokenOrThrow(
  config: DesktopNodeConfig,
  tokenState: EmbeddedGatewayTokenState,
  messages: EmbeddedGatewayTokenMessages,
): string {
  const stored = readStoredEmbeddedGatewayAccessToken(config, tokenState, messages);
  if (stored.token) return stored.token;

  const provisionedToken = resolveProvisionedGatewayToken();
  if (provisionedToken) {
    persistEmbeddedGatewayToken(config, provisionedToken, tokenState);
    return provisionedToken;
  }

  switch (stored.failure) {
    case "decrypt":
      throw new Error(messages.decryptFailError);
    case "empty":
      throw new Error(messages.emptyTokenFailError);
    default:
      throw new Error(messages.missingTokenRefError);
  }
}
