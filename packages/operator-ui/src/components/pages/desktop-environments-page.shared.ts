import {
  DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
  describeDesktopEnvironmentHostAvailability,
  isDesktopEnvironmentHostAvailable,
} from "@tyrum/contracts";
import type { BadgeVariant } from "../ui/badge.js";
import { normalizeHttpUrl } from "../../utils/normalize-http-url.js";

export const DEFAULT_IMAGE_REF = DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF;
export const isHostAvailable = isDesktopEnvironmentHostAvailable;
export const describeHostAvailability = describeDesktopEnvironmentHostAvailability;

export function buildBlockingAvailabilityMessage(
  hosts: ReadonlyArray<{
    label: string;
    docker_available: boolean;
    healthy: boolean;
    last_error: string | null;
  }>,
): string | null {
  if (hosts.length === 0) return "No desktop runtime hosts are registered.";
  if (hosts.some((host) => isHostAvailable(host))) return null;
  return `Desktop environments require a host that is healthy and Docker-ready. ${hosts
    .map((host) => `${host.label}: ${describeHostAvailability(host)}`)
    .join("; ")}`;
}

export function describeStartBlockedReason(params: {
  environmentHostId: string;
  host: { docker_available: boolean; healthy: boolean; last_error: string | null } | null;
}): string | null {
  if (!params.host) return `Host ${params.environmentHostId} is not registered.`;
  return isHostAvailable(params.host) ? null : describeHostAvailability(params.host);
}

export function buildTakeoverHref(httpBaseUrl: string, environmentId: string): string | undefined {
  const normalizedBaseUrl = normalizeHttpUrl(httpBaseUrl);
  if (!normalizedBaseUrl) return undefined;
  return new URL(
    `/desktop-environments/${encodeURIComponent(environmentId)}/takeover`,
    normalizedBaseUrl,
  ).toString();
}

export function hostStatusVariant(host: {
  docker_available: boolean;
  healthy: boolean;
}): BadgeVariant {
  if (!isHostAvailable(host)) return "danger";
  return "outline";
}

export function environmentStatusVariant(
  status: "pending" | "starting" | "running" | "stopped" | "stopping" | "error",
): BadgeVariant {
  if (status === "error") return "danger";
  if (status === "running") return "success";
  if (status === "starting" || status === "pending" || status === "stopping") return "warning";
  return "outline";
}
