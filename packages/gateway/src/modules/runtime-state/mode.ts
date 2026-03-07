export type GatewayStateMode = "local" | "shared";

type RuntimeStateModeConfig = {
  state?: {
    mode?: GatewayStateMode;
  };
};

function asRuntimeStateModeConfig(value: unknown): RuntimeStateModeConfig {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as RuntimeStateModeConfig;
}

export function resolveGatewayStateMode(deploymentConfig: unknown): GatewayStateMode {
  return asRuntimeStateModeConfig(deploymentConfig).state?.mode ?? "local";
}

export function isSharedStateMode(deploymentConfig: unknown): boolean {
  return resolveGatewayStateMode(deploymentConfig) === "shared";
}

export function isLocalStateMode(deploymentConfig: unknown): boolean {
  return resolveGatewayStateMode(deploymentConfig) === "local";
}
