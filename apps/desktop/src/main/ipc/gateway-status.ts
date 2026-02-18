import type { GatewayStatus } from "../gateway-manager.js";

export interface GatewayStatusSnapshot {
  status: GatewayStatus;
  port: number;
}

export function getGatewayStatusSnapshot(
  currentStatus: GatewayStatus | undefined,
  port: number,
): GatewayStatusSnapshot {
  return {
    status: currentStatus ?? "stopped",
    port,
  };
}
