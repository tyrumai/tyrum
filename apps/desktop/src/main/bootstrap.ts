import { maybeRunUtilityHostMode } from "./utility-host.js";

export async function bootstrap(
  importMain: () => Promise<unknown> = () => import("./index.js"),
  runUtilityHostMode: () => Promise<boolean> = maybeRunUtilityHostMode,
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
