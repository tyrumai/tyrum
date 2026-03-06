import type { ElevatedModeStore, OperatorHttpClient } from "@tyrum/operator-core";

export const ELEVATED_MODE_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.admin",
] as const;

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
        persistent: true,
      });
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
