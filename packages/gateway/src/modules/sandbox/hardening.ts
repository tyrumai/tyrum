export type SandboxHardeningProfile = "baseline" | "hardened";

export function resolveSandboxHardeningProfile(raw: string | undefined): SandboxHardeningProfile {
  if (raw?.trim().toLowerCase() === "hardened") return "hardened";
  return "baseline";
}
