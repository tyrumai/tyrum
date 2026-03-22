export async function bootstrap(
  importMain: () => Promise<unknown> = () => import("./index.js"),
): Promise<void> {
  await importMain();
}

export function handleBootstrapError(error: unknown): void {
  console.error("Failed to bootstrap desktop main process", error);
  process.exitCode = 1;
}

void bootstrap().catch(handleBootstrapError);
