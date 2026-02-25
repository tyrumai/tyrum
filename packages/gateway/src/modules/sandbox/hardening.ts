export type SandboxHardeningProfile = "baseline" | "hardened";

export function resolveSandboxHardeningProfile(
  env: NodeJS.ProcessEnv = process.env,
): SandboxHardeningProfile {
  const raw = env["TYRUM_TOOLRUNNER_HARDENING_PROFILE"]?.trim().toLowerCase();
  if (raw === "hardened") return "hardened";
  return "baseline";
}
