import type { ExecutionArtifactSensitivity } from "./execution-artifacts.js";

export function parseEvidenceSensitivity(
  raw: string | undefined,
  fallback: ExecutionArtifactSensitivity,
): ExecutionArtifactSensitivity {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "normal" || normalized === "sensitive") return normalized;
  return fallback;
}
