import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdsForClientCapability,
} from "@tyrum/schemas";
import type { AuthTokenService } from "../auth/auth-token-service.js";
import { isPairingBlockedStatus, type NodePairingDal } from "../node/pairing-dal.js";
import type { Logger } from "../observability/logger.js";
import { DesktopEnvironmentDal, type DesktopEnvironment } from "./dal.js";
import { loadOrCreateDesktopEnvironmentIdentity } from "./device-identity.js";
import {
  combineDockerError,
  containerNameForEnvironment,
  ensureImageAvailable,
  inspectContainer,
  readContainerLogs,
  readTakeoverUrl,
  removeContainer,
  runDocker,
} from "./docker-cli.js";

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const CONTAINER_NODE_HOME = "/var/lib/tyrum-node";
const CONTAINER_IDENTITY_PATH = `${CONTAINER_NODE_HOME}/desktop-node/device-identity.json`;
const CONTAINER_GATEWAY_TOKEN_PATH = "/run/tyrum/gateway-token";
const OFFICIAL_DESKTOP_SANDBOX_IMAGE_REF_PREFIX = "ghcr.io/rhernaus/tyrum-desktop-sandbox:";
const DESKTOP_ALLOWLIST = descriptorIdsForClientCapability("desktop").map((id) => ({
  id,
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
}));

type DesktopEnvironmentRuntimeManagerOptions = {
  hostId: string;
  tyrumHome: string;
  gatewayPort: number;
  gatewayWsUrl?: string;
  tokenTtlSeconds?: number;
  hostPlatform?: NodeJS.Platform;
  hostArch?: string;
};

type DesktopEnvironmentPaths = {
  runtimeHomeDir: string;
  runtimeIdentityDir: string;
  identityPath: string;
  secretsDir: string;
  gatewayTokenPath: string;
};

function resolveEnvironmentPaths(
  tyrumHome: string,
  environmentId: string,
): DesktopEnvironmentPaths {
  const environmentDir = join(tyrumHome, "desktop-environments", environmentId);
  return {
    runtimeHomeDir: join(environmentDir, "runtime-home"),
    runtimeIdentityDir: join(environmentDir, "runtime-home", "desktop-node"),
    identityPath: join(environmentDir, "identity", "desktop-node", "device-identity.json"),
    secretsDir: join(environmentDir, "secrets"),
    gatewayTokenPath: join(environmentDir, "secrets", "gateway-token"),
  };
}

async function ensureNodeIdentity(identityPath: string): Promise<{ deviceId: string }> {
  const identity = await loadOrCreateDesktopEnvironmentIdentity(identityPath);
  return { deviceId: identity.deviceId };
}

async function writeGatewayToken(tokenPath: string, token: string): Promise<void> {
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
}

export class DesktopEnvironmentRuntimeManager {
  constructor(
    private readonly environmentDal: DesktopEnvironmentDal,
    private readonly nodePairingDal: NodePairingDal,
    private readonly authTokens: AuthTokenService,
    private readonly logger: Logger,
    private readonly options: DesktopEnvironmentRuntimeManagerOptions,
  ) {}

  async reconcileAll(): Promise<void> {
    const environments = await this.environmentDal.listByHost(this.options.hostId);
    for (const environment of environments) {
      try {
        await this.reconcileEnvironment(environment);
      } catch (error) {
        await this.recordReconcileFailure(environment, error);
      }
    }
  }

  private async reconcileEnvironment(
    environment: DesktopEnvironment & { tenant_id: string },
  ): Promise<void> {
    const containerName = containerNameForEnvironment(environment.environment_id);
    const paths = resolveEnvironmentPaths(this.options.tyrumHome, environment.environment_id);
    const imagePlatform = this.resolveManagedImagePlatform(environment.image_ref);
    await mkdir(paths.runtimeHomeDir, { recursive: true, mode: 0o700 });
    await mkdir(paths.runtimeIdentityDir, { recursive: true, mode: 0o700 });
    await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
    const { deviceId } = await ensureNodeIdentity(paths.identityPath);

    if (!environment.desired_running) {
      const logs = (await inspectContainer(containerName))
        ? await readContainerLogs(containerName)
        : [];
      await removeContainer(containerName);
      await this.environmentDal.updateRuntime({
        tenantId: environment.tenant_id,
        environmentId: environment.environment_id,
        status: "stopped",
        nodeId: deviceId,
        takeoverUrl: null,
        lastError: null,
        logs,
      });
      return;
    }

    let inspect = await inspectContainer(containerName);
    let removedForRecreate = false;
    const currentImage = inspect?.Config?.Image?.trim();
    if (inspect && currentImage && currentImage !== environment.image_ref) {
      await removeContainer(containerName);
      inspect = null;
      removedForRecreate = true;
    }

    if (inspect && inspect.State?.Status !== "running" && imagePlatform) {
      await removeContainer(containerName);
      inspect = null;
      removedForRecreate = true;
    }

    if (!inspect && environment.status === "error" && !removedForRecreate) {
      return;
    }

    if (!inspect) {
      if (imagePlatform) {
        await ensureImageAvailable(environment.image_ref, { platform: imagePlatform });
      } else {
        await ensureImageAvailable(environment.image_ref);
      }
      const issuedToken = await this.authTokens.issueToken({
        tenantId: environment.tenant_id,
        role: "node",
        deviceId,
        scopes: [],
        ttlSeconds: this.options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
        displayName: `desktop-environment:${environment.environment_id}`,
      });
      await writeGatewayToken(paths.gatewayTokenPath, issuedToken.token);
      const runArgs = ["run"];
      if (imagePlatform) {
        runArgs.push("--platform", imagePlatform);
      }
      runArgs.push(
        "--detach",
        "--name",
        containerName,
        "--add-host",
        "host.containers.internal:host-gateway",
        "--label",
        `tyrum.desktop_environment_id=${environment.environment_id}`,
        "--label",
        `tyrum.desktop_environment_host_id=${this.options.hostId}`,
        "--volume",
        `${paths.runtimeHomeDir}:${CONTAINER_NODE_HOME}`,
        "--volume",
        `${paths.identityPath}:${CONTAINER_IDENTITY_PATH}:ro`,
        "--volume",
        `${paths.gatewayTokenPath}:${CONTAINER_GATEWAY_TOKEN_PATH}:ro`,
        "--publish",
        "127.0.0.1::5900",
        "--publish",
        "127.0.0.1::6080",
        "--env",
        `TYRUM_HOME=${CONTAINER_NODE_HOME}`,
        "--env",
        `TYRUM_GATEWAY_TOKEN_PATH=${CONTAINER_GATEWAY_TOKEN_PATH}`,
        "--env",
        `TYRUM_GATEWAY_WS_URL=${this.resolveGatewayWsUrl()}`,
        "--env",
        `TYRUM_NODE_LABEL=${environment.label ?? `desktop-environment:${environment.environment_id}`}`,
        "--env",
        "TYRUM_NODE_MODE=desktop-sandbox",
        environment.image_ref,
      );
      const runResult = await runDocker(runArgs);
      if (runResult.status !== 0) {
        throw new Error(
          combineDockerError("failed to start desktop environment container", runResult),
        );
      }
      inspect = await inspectContainer(containerName);
    }

    if (!inspect) {
      throw new Error("desktop environment container inspect failed after start");
    }

    if (inspect.State?.Status !== "running") {
      const startResult = await runDocker(["start", containerName], { timeoutMs: 15_000 });
      if (startResult.status !== 0) {
        throw new Error(
          combineDockerError("failed to start existing desktop environment container", startResult),
        );
      }
      inspect = (await inspectContainer(containerName)) ?? inspect;
    }

    await this.approveManagedPairing(environment.tenant_id, deviceId);

    await this.environmentDal.updateRuntime({
      tenantId: environment.tenant_id,
      environmentId: environment.environment_id,
      status: inspect.State?.Status === "running" ? "running" : "starting",
      nodeId: deviceId,
      takeoverUrl: readTakeoverUrl(inspect),
      lastError: null,
      logs: await readContainerLogs(containerName),
    });
  }

  private resolveGatewayWsUrl(): string {
    const override = this.options.gatewayWsUrl?.trim();
    if (override) return override;
    return `ws://host.containers.internal:${String(this.options.gatewayPort)}/ws`;
  }

  private resolveManagedImagePlatform(imageRef: string): string | undefined {
    const hostPlatform = this.options.hostPlatform ?? process.platform;
    const hostArch = this.options.hostArch ?? process.arch;
    if (
      hostPlatform === "darwin" &&
      hostArch === "arm64" &&
      imageRef.trim().startsWith(OFFICIAL_DESKTOP_SANDBOX_IMAGE_REF_PREFIX)
    ) {
      return "linux/amd64";
    }
    return undefined;
  }

  private async recordReconcileFailure(
    environment: DesktopEnvironment & { tenant_id: string },
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error("desktop_environment.reconcile_failed", {
      environment_id: environment.environment_id,
      host_id: this.options.hostId,
      image_platform: this.resolveManagedImagePlatform(environment.image_ref) ?? null,
      error: message,
    });

    const logs = await this.readFailureLogs(environment);

    try {
      await this.environmentDal.updateRuntime({
        tenantId: environment.tenant_id,
        environmentId: environment.environment_id,
        status: "error",
        nodeId: environment.node_id,
        takeoverUrl: environment.takeover_url,
        lastError: message,
        logs,
      });
    } catch (persistError) {
      this.logger.error("desktop_environment.reconcile_failure_persist_failed", {
        environment_id: environment.environment_id,
        host_id: this.options.hostId,
        error: persistError instanceof Error ? persistError.message : String(persistError),
      });
    }
  }

  private async readFailureLogs(
    environment: DesktopEnvironment & { tenant_id: string },
  ): Promise<string[]> {
    const containerName = containerNameForEnvironment(environment.environment_id);
    const inspect = await inspectContainer(containerName);
    if (!inspect) {
      return [];
    }

    try {
      return await readContainerLogs(containerName);
    } catch (error) {
      this.logger.error("desktop_environment.reconcile_failure_logs_failed", {
        environment_id: environment.environment_id,
        host_id: this.options.hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async approveManagedPairing(tenantId: string, nodeId: string): Promise<void> {
    const pairing = await this.nodePairingDal.getByNodeId(nodeId, tenantId);
    if (!pairing || pairing.status === "reviewing" || !isPairingBlockedStatus(pairing.status)) {
      return;
    }
    await this.nodePairingDal.resolve({
      tenantId,
      pairingId: pairing.pairing_id,
      decision: "approved",
      trustLevel: "local",
      capabilityAllowlist: DESKTOP_ALLOWLIST,
      reason: "gateway-managed desktop environment",
      resolvedBy: { kind: "desktop_environment_runtime", host_id: this.options.hostId },
      allowedCurrentStatuses: ["queued", "awaiting_human"],
    });
  }
}
