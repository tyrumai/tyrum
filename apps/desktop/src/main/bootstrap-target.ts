import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type BootstrapTarget = { kind: "app" } | { kind: "delegate"; scriptPath: string };

export function resolveBootstrapTarget(options?: {
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
  bootstrapModuleUrl?: string;
}): BootstrapTarget {
  const env = options?.env ?? process.env;
  if (env["ELECTRON_RUN_AS_NODE"] !== "1") {
    return { kind: "app" };
  }

  const argv = options?.argv ?? process.argv;
  const scriptPath = argv[1];
  if (!scriptPath) {
    return { kind: "app" };
  }

  const bootstrapModuleUrl = options?.bootstrapModuleUrl ?? import.meta.url;
  const bootstrapPath = resolve(fileURLToPath(bootstrapModuleUrl));
  const resolvedScriptPath = resolve(scriptPath);
  if (resolvedScriptPath === bootstrapPath) {
    return { kind: "app" };
  }

  return { kind: "delegate", scriptPath: resolvedScriptPath };
}
