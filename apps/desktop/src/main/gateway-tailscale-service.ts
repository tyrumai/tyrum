import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DeploymentConfig,
  DeploymentConfigGetResponse,
  DeploymentConfigUpdateRequest,
  DeploymentConfigUpdateResponse,
} from "@tyrum/contracts";
import { TailscaleServeService, type TailscaleServeStatus } from "@tyrum/runtime-node-control";

const execFileAsync = promisify(execFile);

type TailscaleServeAction = "enable" | "status" | "disable";

type EmbeddedGatewayTailscaleParams = {
  action: TailscaleServeAction;
  gatewayPort: number;
  home: string;
  httpBaseUrl: string;
  token: string;
};

async function runExec(
  file: string,
  args: readonly string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(file, [...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    if (failed.code === "ENOENT") throw failed;
    return {
      status: typeof failed.code === "number" ? failed.code : 1,
      stdout: typeof failed.stdout === "string" ? failed.stdout : "",
      stderr: typeof failed.stderr === "string" ? failed.stderr : failed.message,
    };
  }
}

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
      exec: runExec,
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
