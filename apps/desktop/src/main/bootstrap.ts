async function bootstrap(): Promise<void> {
  await import("./index.js");
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to bootstrap desktop main process", error);
  process.exitCode = 1;
});
