import type { ElevatedModeStore, OperatorHttpClient } from "@tyrum/operator-app";

export const ELEVATED_MODE_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.admin",
] as const;
export const ADMIN_ACCESS_TTL_SECONDS = 60 * 10;

export interface ElevatedModeController {
  enter(): Promise<void>;
  exit(): Promise<void>;
}

export function createPersistentElevatedModeController({
  http,
  deviceId,
  elevatedModeStore,
}: {
  http: OperatorHttpClient;
  deviceId: string;
  elevatedModeStore: ElevatedModeStore;
}): ElevatedModeController {
  return {
    enter: async () => {
      const issued = await http.deviceTokens.issue({
        device_id: deviceId,
        role: "client",
        scopes: [...ELEVATED_MODE_SCOPES],
        ttl_seconds: ADMIN_ACCESS_TTL_SECONDS,
      });
      if (!issued.expires_at) {
        throw new Error("Gateway returned admin access without an expiration.");
      }
      elevatedModeStore.enter({
        elevatedToken: issued.token,
        expiresAt: issued.expires_at,
      });
    },
    exit: async () => {
      const elevatedToken = elevatedModeStore.getSnapshot().elevatedToken?.trim();
      if (!elevatedToken) {
        elevatedModeStore.exit();
        return;
      }
      await http.deviceTokens.revoke({ token: elevatedToken });
      elevatedModeStore.exit();
    },
  };
}
