import { isUtilityHostInvocation } from "./utility-host-flag.js";

async function maybeRunUtilityHostModeFromArgv(): Promise<boolean> {
  if (!isUtilityHostInvocation(process.argv)) {
    return false;
  }

  const { maybeRunUtilityHostMode } = await import("./utility-host.js");
  return await maybeRunUtilityHostMode();
}

export async function bootstrap(
  importMain: () => Promise<unknown> = () => import("./index.js"),
  runUtilityHostMode: () => Promise<boolean> = maybeRunUtilityHostModeFromArgv,
): Promise<void> {
  if (await runUtilityHostMode()) {
    return;
  }

  await importMain();
}

export function handleBootstrapError(error: unknown): void {
  console.error("Failed to bootstrap desktop main process", error);
  process.exitCode = 1;
}

void bootstrap().catch(handleBootstrapError);
