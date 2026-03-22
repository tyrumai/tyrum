import { app, utilityProcess } from "electron";

const [, , modulePath, ...childArgs] = process.argv;

app.commandLine.appendSwitch("disable-gpu");
if (process.platform === "linux") {
  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("ozone-platform", "headless");
}

if (!modulePath) {
  console.error("Utility host requires a module path.");
  process.exit(1);
}

let child = null;

function pipeOutput(stream, target) {
  stream?.on("data", (chunk) => {
    target.write(chunk);
  });
}

function terminateChild() {
  if (!child) return;
  child.kill();
}

async function main() {
  await app.whenReady();

  const options = {
    cwd: process.cwd(),
    env: process.env,
    serviceName: "Tyrum Integration Utility Host",
    stdio: ["ignore", "pipe", "pipe"],
    ...(process.platform === "darwin" ? { allowLoadingUnsignedLibraries: true } : {}),
  };

  child = utilityProcess.fork(modulePath, childArgs, options);
  pipeOutput(child.stdout, process.stdout);
  pipeOutput(child.stderr, process.stderr);

  child.once("exit", (code) => {
    child = null;
    process.exitCode = code ?? 1;
    void app.quit();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    terminateChild();
    void app.quit();
  });
}

app.on("before-quit", terminateChild);

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
