import { app, utilityProcess } from "electron";

export const UTILITY_HOST_FLAG = "--tyrum-utility-host";

function pipeOutput(stream: NodeJS.ReadableStream | null, target: NodeJS.WritableStream): void {
  stream?.on("data", (chunk) => {
    target.write(chunk);
  });
}

export async function maybeRunUtilityHostMode(): Promise<boolean> {
  if (process.argv[2] !== UTILITY_HOST_FLAG) {
    return false;
  }

  app.commandLine.appendSwitch("disable-gpu");
  if (process.platform === "linux") {
    app.commandLine.appendSwitch("headless");
    app.commandLine.appendSwitch("ozone-platform", "headless");
  }

  const modulePath = process.argv[3];
  const childArgs = process.argv.slice(4);
  if (!modulePath) {
    throw new Error("Utility host requires a module path.");
  }

  let child: ReturnType<typeof utilityProcess.fork> | null = null;
  const terminateChild = (): void => {
    child?.kill();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      terminateChild();
      void app.quit();
    });
  }
  app.on("before-quit", terminateChild);

  await app.whenReady();

  const options: Parameters<typeof utilityProcess.fork>[2] = {
    cwd: process.cwd(),
    env: process.env,
    serviceName: "Tyrum Integration Utility Host",
    stdio: ["ignore", "pipe", "pipe"],
    ...(process.platform === "darwin" ? { allowLoadingUnsignedLibraries: true } : {}),
  };

  child = utilityProcess.fork(modulePath, childArgs, options);
  pipeOutput(child.stdout, process.stdout);
  pipeOutput(child.stderr, process.stderr);

  await new Promise<void>((resolve, reject) => {
    child?.once("error", reject);
    child?.once("exit", (code) => {
      child = null;
      process.exitCode = code ?? 1;
      resolve();
      void app.quit();
    });
  });

  return true;
}
