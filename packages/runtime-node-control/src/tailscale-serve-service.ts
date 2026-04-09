import { Socket } from "node:net";
import {
  canonicalizeJson,
  clearManagedTailscaleServeState,
  readManagedTailscaleServeState,
  TAILSCALE_ADMIN_MACHINES_URL,
  writeManagedTailscaleServeState,
  type ManagedTailscaleServeState,
} from "./tailscale-serve-state.js";

export type TailscaleServeOwnership = "disabled" | "managed" | "unmanaged" | "conflict";

export interface TailscaleGatewayProbeResult {
  reachable: boolean;
  reason: string | null;
}

export interface TailscaleServeStatus {
  adminUrl: string;
  binaryAvailable: boolean;
  backendRunning: boolean;
  backendState: string;
  currentPublicBaseUrl: string;
  dnsName: string | null;
  gatewayReachable: boolean;
  gatewayReachabilityReason: string | null;
  gatewayTarget: string;
  managedStatePresent: boolean;
  ownership: TailscaleServeOwnership;
  publicBaseUrlMatches: boolean | null;
  publicUrl: string | null;
  reason: string | null;
}

export interface TailscaleServeCommandPort {
  exec(
    file: string,
    args: readonly string[],
  ): Promise<{ status: number; stdout: string; stderr: string }>;
  getPublicBaseUrl(): Promise<string>;
  setPublicBaseUrl(next: string): Promise<void>;
  probeGatewayTarget?(
    target: Readonly<{ host: string; port: number }>,
  ): Promise<TailscaleGatewayProbeResult>;
}

type TailscaleServeEnvironment = {
  managedState: ManagedTailscaleServeState | null;
  reason: string | null;
  serveConfigPresent: boolean;
  serveSnapshotCanonical: string | null;
  status: TailscaleServeStatus;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeDnsName(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim().replace(/\.$/, "") : "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

function isNonEmptyObject(value: unknown): boolean {
  return (
    !!value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0
  );
}

async function probeGatewayTargetWithSocket(
  target: Readonly<{ host: string; port: number }>,
): Promise<TailscaleGatewayProbeResult> {
  return await new Promise<TailscaleGatewayProbeResult>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: TailscaleGatewayProbeResult): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1_500);
    socket.once("connect", () => finish({ reachable: true, reason: null }));
    socket.once("timeout", () =>
      finish({ reachable: false, reason: "gateway target probe timed out after 1500ms" }),
    );
    socket.once("error", (error) =>
      finish({
        reachable: false,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    socket.connect(target.port, target.host);
  });
}

export class TailscaleServeService {
  constructor(
    private readonly home: string,
    private readonly target: { host: string; port: number },
    private readonly port: TailscaleServeCommandPort,
  ) {}

  async status(): Promise<TailscaleServeStatus> {
    return (await this.inspect()).status;
  }

  async enable(): Promise<TailscaleServeStatus> {
    const initial = await this.inspect();
    if (!initial.status.binaryAvailable)
      throw new Error(initial.status.reason ?? "tailscale is not installed");
    if (!initial.status.backendRunning)
      throw new Error(initial.status.reason ?? "tailscale is not running");
    if (!initial.status.publicUrl) throw new Error("tailscale DNS name is unavailable");
    if (initial.status.ownership === "unmanaged" || initial.status.ownership === "conflict") {
      throw new Error(
        initial.status.reason ?? "tailscale serve is already managed elsewhere on this machine",
      );
    }
    if (initial.status.ownership === "managed" && initial.status.publicBaseUrlMatches) {
      return initial.status;
    }

    const previousPublicBaseUrl =
      initial.managedState?.previousPublicBaseUrl ?? initial.status.currentPublicBaseUrl;
    await this.port.exec("tailscale", ["serve", "--yes", "--bg", this.gatewayTarget()]);
    const refreshed = await this.inspect();
    if (!refreshed.status.publicUrl || !refreshed.serveSnapshotCanonical) {
      throw new Error("tailscale serve did not expose a Tyrum HTTPS URL");
    }

    await writeManagedTailscaleServeState(this.home, {
      publicUrl: refreshed.status.publicUrl,
      previousPublicBaseUrl,
      dnsName: refreshed.status.dnsName ?? "",
      target: this.target,
      serveSnapshotCanonical: refreshed.serveSnapshotCanonical,
    });
    await this.port.setPublicBaseUrl(refreshed.status.publicUrl);
    return await this.status();
  }

  async disable(): Promise<TailscaleServeStatus> {
    const initial = await this.inspect();
    if (!initial.managedState) {
      if (initial.status.ownership === "disabled") return initial.status;
      throw new Error(initial.status.reason ?? "tailscale serve is not managed by Tyrum");
    }
    if (initial.serveConfigPresent && initial.status.ownership !== "managed") {
      throw new Error(
        initial.status.reason ?? "tailscale serve has drifted from Tyrum-managed state",
      );
    }

    if (initial.serveConfigPresent) {
      await this.port.exec("tailscale", ["serve", "reset"]);
    }
    if (
      normalizeBaseUrl(initial.status.currentPublicBaseUrl) ===
      normalizeBaseUrl(initial.managedState.publicUrl)
    ) {
      await this.port.setPublicBaseUrl(initial.managedState.previousPublicBaseUrl);
    }
    await clearManagedTailscaleServeState(this.home);
    return await this.status();
  }

  private async inspect(): Promise<TailscaleServeEnvironment> {
    const publicBaseUrl = await this.port.getPublicBaseUrl();
    const managedState = await readManagedTailscaleServeState(this.home);
    const gatewayProbe = await this.probeGatewayTarget();
    try {
      const tailscaleStatusResult = await this.port.exec("tailscale", ["status", "--json"]);
      const tailscaleStatus = parseJson(tailscaleStatusResult.stdout, "tailscale status") as Record<
        string,
        unknown
      >;
      const backendState =
        typeof tailscaleStatus["BackendState"] === "string"
          ? tailscaleStatus["BackendState"]
          : "Unknown";
      const dnsName = normalizeDnsName(
        tailscaleStatus["Self"] && typeof tailscaleStatus["Self"] === "object"
          ? (tailscaleStatus["Self"] as Record<string, unknown>)["DNSName"]
          : undefined,
      );
      const publicUrl = dnsName ? `https://${dnsName}` : null;
      const serveResult = await this.port.exec("tailscale", ["serve", "status", "--json"]);
      const serveStatus = parseJson(serveResult.stdout, "tailscale serve status");
      const serveConfigPresent = isNonEmptyObject(serveStatus);
      const serveSnapshotCanonical = serveConfigPresent ? canonicalizeJson(serveStatus) : null;
      const ownership = !managedState
        ? serveConfigPresent
          ? "unmanaged"
          : "disabled"
        : !serveConfigPresent
          ? "disabled"
          : managedState.serveSnapshotCanonical === serveSnapshotCanonical
            ? "managed"
            : "conflict";
      return {
        managedState,
        reason:
          backendState === "Running"
            ? this.reasonForOwnership(ownership)
            : `tailscale backend state: ${backendState}`,
        serveConfigPresent,
        serveSnapshotCanonical,
        status: {
          adminUrl: TAILSCALE_ADMIN_MACHINES_URL,
          binaryAvailable: true,
          backendRunning: backendState === "Running",
          backendState,
          currentPublicBaseUrl: publicBaseUrl,
          dnsName,
          gatewayReachable: gatewayProbe.reachable,
          gatewayReachabilityReason: gatewayProbe.reason,
          gatewayTarget: this.gatewayTarget(),
          managedStatePresent: managedState !== null,
          ownership,
          publicBaseUrlMatches: publicUrl
            ? normalizeBaseUrl(publicBaseUrl) === normalizeBaseUrl(publicUrl)
            : null,
          publicUrl,
          reason:
            backendState === "Running"
              ? this.reasonForOwnership(ownership)
              : `tailscale backend state: ${backendState}`,
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "ENOENT") {
        return {
          managedState,
          reason: "tailscale is not installed on this machine",
          serveConfigPresent: false,
          serveSnapshotCanonical: null,
          status: {
            adminUrl: TAILSCALE_ADMIN_MACHINES_URL,
            binaryAvailable: false,
            backendRunning: false,
            backendState: "missing",
            currentPublicBaseUrl: publicBaseUrl,
            dnsName: null,
            gatewayReachable: gatewayProbe.reachable,
            gatewayReachabilityReason: gatewayProbe.reason,
            gatewayTarget: this.gatewayTarget(),
            managedStatePresent: managedState !== null,
            ownership: "disabled",
            publicBaseUrlMatches: null,
            publicUrl: null,
            reason: "tailscale is not installed on this machine",
          },
        };
      }
      throw new Error(`tailscale serve inspection failed: ${message}`, { cause: error });
    }
  }

  private async probeGatewayTarget(): Promise<TailscaleGatewayProbeResult> {
    if (typeof this.port.probeGatewayTarget === "function") {
      return await this.port.probeGatewayTarget(this.target);
    }
    return await probeGatewayTargetWithSocket(this.target);
  }

  private gatewayTarget(): string {
    return `http://${this.target.host}:${String(this.target.port)}`;
  }

  private reasonForOwnership(ownership: TailscaleServeOwnership): string | null {
    switch (ownership) {
      case "unmanaged":
        return "tailscale serve is already configured on this machine and is not managed by Tyrum";
      case "conflict":
        return "tailscale serve no longer matches Tyrum-managed state; resolve it manually before changing it here";
      default:
        return null;
    }
  }
}
