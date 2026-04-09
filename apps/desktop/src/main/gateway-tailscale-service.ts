import {
  DeploymentConfig,
  DeploymentConfigGetResponse,
  DeploymentConfigUpdateRequest,
  DeploymentConfigUpdateResponse,
} from "@tyrum/contracts";
import {
  runBufferedExecFile,
  TailscaleServeService,
  type TailscaleServeStatus,
} from "@tyrum/runtime-node-control";

type TailscaleServeAction = "enable" | "status" | "disable";

type EmbeddedGatewayTailscaleParams = {
  action: TailscaleServeAction;
  gatewayPort: number;
  home: string;
  httpBaseUrl: string;
  token: string;
};

function buildAuthorizedHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
}

async function readDeploymentConfig(
  httpBaseUrl: string,
  token: string,
): Promise<DeploymentConfigGetResponse> {
  const response = await fetch(new URL("/system/deployment-config", httpBaseUrl), {
    headers: buildAuthorizedHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to load deployment config (${response.status})`);
  }
  return DeploymentConfigGetResponse.parse((await response.json()) as unknown);
}

async function writeDeploymentConfig(params: {
  config: DeploymentConfig;
  httpBaseUrl: string;
  reason: string;
  token: string;
}): Promise<void> {
  const response = await fetch(new URL("/system/deployment-config", params.httpBaseUrl), {
    method: "PUT",
    headers: {
      ...buildAuthorizedHeaders(params.token),
      "content-type": "application/json",
    },
    body: JSON.stringify(
      DeploymentConfigUpdateRequest.parse({
        config: params.config,
        reason: params.reason,
      }),
    ),
  });
  if (!response.ok) {
    throw new Error(`Failed to update deployment config (${response.status})`);
  }
  DeploymentConfigUpdateResponse.parse((await response.json()) as unknown);
}

export async function runEmbeddedGatewayTailscaleServeAction(
  params: EmbeddedGatewayTailscaleParams,
): Promise<TailscaleServeStatus> {
  const service = new TailscaleServeService(
    params.home,
    { host: "127.0.0.1", port: params.gatewayPort },
    {
      exec: runBufferedExecFile,
      getPublicBaseUrl: async () =>
        (await readDeploymentConfig(params.httpBaseUrl, params.token)).config.server.publicBaseUrl,
      setPublicBaseUrl: async (next) => {
        const latest = await readDeploymentConfig(params.httpBaseUrl, params.token);
        await writeDeploymentConfig({
          config: DeploymentConfig.parse({
            ...latest.config,
            server: { ...latest.config.server, publicBaseUrl: next },
          }),
          httpBaseUrl: params.httpBaseUrl,
          reason: `desktop.tailscale_serve.${params.action}`,
          token: params.token,
        });
      },
    },
  );

  return params.action === "enable"
    ? await service.enable()
    : params.action === "disable"
      ? await service.disable()
      : await service.status();
}
