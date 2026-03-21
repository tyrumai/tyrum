import { pathToFileURL } from "node:url";
import { resolveBootstrapTarget } from "./bootstrap-target.js";

async function bootstrap(): Promise<void> {
  const target = resolveBootstrapTarget({ bootstrapModuleUrl: import.meta.url });
  if (target.kind === "delegate") {
    await import(pathToFileURL(target.scriptPath).href);
    return;
  }

  await import("./index.js");
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to bootstrap desktop main process", error);
  process.exitCode = 1;
});
