import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdsForClientCapability,
} from "@tyrum/schemas";
import type { AuthTokenService } from "../auth/auth-token-service.js";
import type { NodePairingDal } from "../node/pairing-dal.js";
import type { Logger } from "../observability/logger.js";
import { DesktopEnvironmentDal, type DesktopEnvironment } from "./dal.js";
import { loadOrCreateDesktopEnvironmentIdentity } from "./device-identity.js";
import {
  combineDockerError,
  containerNameForEnvironment,
  inspectContainer,
  readContainerLogs,
  readTakeoverUrl,
  removeContainer,
  runDocker,
} from "./docker-cli.js";

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const DESKTOP_ALLOWLIST = descriptorIdsForClientCapability("desktop").map((id) => ({
  id,
  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
}));

async function ensureNodeIdentity(baseDir: string): Promise<{ deviceId: string }> {
  const identityPath = join(baseDir, "desktop-node", "device-identity.json");
  const identity = await loadOrCreateDesktopEnvironmentIdentity(identityPath);
  return { deviceId: identity.deviceId };
}

export class DesktopEnvironmentRuntimeManager {
  constructor(
    private readonly environmentDal: DesktopEnvironmentDal,
    private readonly nodePairingDal: NodePairingDal,
    private readonly authTokens: AuthTokenService,
    private readonly logger: Logger,
    private readonly options: {
      hostId: string;
      tyrumHome: string;
      gatewayPort: number;
      gatewayWsUrl?: string;
      tokenTtlSeconds?: number;
    },
  ) {}

  async reconcileAll(): Promise<void> {
    const environments = await this.environmentDal.listByHost(this.options.hostId);
    for (const environment of environments) {
      try {
        await this.reconcileEnvironment(environment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("desktop_environment.reconcile_failed", {
          environment_id: environment.environment_id,
          host_id: this.options.hostId,
          error: message,
        });
        await this.environmentDal.updateRuntime({
          tenantId: environment.tenant_id,
          environmentId: environment.environment_id,
          status: "error",
          nodeId: environment.node_id,
          takeoverUrl: environment.takeover_url,
          lastError: message,
          logs:
            environment.status === "running"
              ? await readContainerLogs(containerNameForEnvironment(environment.environment_id))
              : [],
        });
      }
    }
  }

  private async reconcileEnvironment(
    environment: DesktopEnvironment & { tenant_id: string },
  ): Promise<void> {
    const containerName = containerNameForEnvironment(environment.environment_id);
    const stateDir = join(
      this.options.tyrumHome,
      "desktop-environments",
      environment.environment_id,
      "node-home",
    );
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const { deviceId } = await ensureNodeIdentity(stateDir);

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
    const currentImage = inspect?.Config?.Image?.trim();
    if (inspect && currentImage && currentImage !== environment.image_ref) {
      await removeContainer(containerName);
      inspect = null;
    }

    if (!inspect) {
      const issuedToken = await this.authTokens.issueToken({
        tenantId: environment.tenant_id,
        role: "node",
        deviceId,
        scopes: [],
        ttlSeconds: this.options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
        displayName: `desktop-environment:${environment.environment_id}`,
      });
      const runResult = await runDocker([
        "run",
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
        `${stateDir}:/var/lib/tyrum-node`,
        "--publish",
        "127.0.0.1::5900",
        "--publish",
        "127.0.0.1::6080",
        "--env",
        "TYRUM_HOME=/var/lib/tyrum-node",
        "--env",
        `TYRUM_GATEWAY_TOKEN=${issuedToken.token}`,
        "--env",
        `TYRUM_GATEWAY_WS_URL=${this.resolveGatewayWsUrl()}`,
        "--env",
        `TYRUM_NODE_LABEL=${environment.label ?? `desktop-environment:${environment.environment_id}`}`,
        "--env",
        "TYRUM_NODE_MODE=desktop-sandbox",
        environment.image_ref,
      ]);
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

  private async approveManagedPairing(tenantId: string, nodeId: string): Promise<void> {
    const pairing = await this.nodePairingDal.getByNodeId(nodeId, tenantId);
    if (!pairing || pairing.status !== "pending") return;
    await this.nodePairingDal.resolve({
      tenantId,
      pairingId: pairing.pairing_id,
      decision: "approved",
      trustLevel: "local",
      capabilityAllowlist: DESKTOP_ALLOWLIST,
      reason: "gateway-managed desktop environment",
      resolvedBy: { kind: "desktop_environment_runtime", host_id: this.options.hostId },
    });
  }
}
