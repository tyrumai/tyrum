import type { BadgeVariant } from "../ui/badge.js";
import { normalizeHttpUrl } from "../../utils/normalize-http-url.js";

export const DEFAULT_IMAGE_REF = "tyrum-desktop-sandbox:latest";

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
  if (!host.docker_available || !host.healthy) return "danger";
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
