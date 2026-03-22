import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { ForkOptions, UtilityProcess } from "electron";

export type DesktopSubprocessLaunchSpec =
  | {
      kind: "node";
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
    }
  | {
      kind: "utility";
      modulePath: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      serviceName: string;
      allowLoadingUnsignedLibraries?: boolean;
    };

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
type ErrorListener = (error: Error) => void;

export interface DesktopSubprocess {
  readonly kind: DesktopSubprocessLaunchSpec["kind"];
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  onExit(listener: ExitListener): void;
  onceExit(listener: ExitListener): void;
  onceComplete(listener: ExitListener): void;
  onceError(listener: ErrorListener): void;
  terminate(): void;
  forceTerminate(): void;
}

function buildSubprocessEnv(overrides: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );

  return {
    ...inherited,
    ...overrides,
  };
}

function isMissingProcessError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ESRCH"
  );
}

function forceTerminatePid(pid: number | undefined): void {
  if (pid === undefined) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

class NodeDesktopSubprocess implements DesktopSubprocess {
  readonly kind = "node" as const;

  constructor(private readonly child: ChildProcess) {}

  get stdout(): NodeJS.ReadableStream | null {
    return this.child.stdout;
  }

  get stderr(): NodeJS.ReadableStream | null {
    return this.child.stderr;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.child.signalCode;
  }

  onExit(listener: ExitListener): void {
    this.child.on("exit", (code, signal) => {
      listener(code, signal as NodeJS.Signals | null);
    });
  }

  onceExit(listener: ExitListener): void {
    this.child.once("exit", (code, signal) => {
      listener(code, signal as NodeJS.Signals | null);
    });
  }

  onceComplete(listener: ExitListener): void {
    this.child.once("close", (code, signal) => {
      listener(code, signal as NodeJS.Signals | null);
    });
  }

  onceError(listener: ErrorListener): void {
    this.child.once("error", listener);
  }

  terminate(): void {
    try {
      this.child.kill("SIGTERM");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }

  forceTerminate(): void {
    if (this.child.pid !== undefined) {
      forceTerminatePid(this.child.pid);
      return;
    }

    try {
      this.child.kill("SIGKILL");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }
}

class UtilityDesktopSubprocess implements DesktopSubprocess {
  readonly kind = "utility" as const;
  private exitCodeValue: number | null = null;

  constructor(private readonly child: UtilityProcess) {
    this.child.once("exit", (code) => {
      this.exitCodeValue = code;
    });
  }

  get stdout(): NodeJS.ReadableStream | null {
    return this.child.stdout;
  }

  get stderr(): NodeJS.ReadableStream | null {
    return this.child.stderr;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get exitCode(): number | null {
    return this.exitCodeValue;
  }

  get signalCode(): NodeJS.Signals | null {
    return null;
  }

  onExit(listener: ExitListener): void {
    this.child.on("exit", (code) => {
      listener(code, null);
    });
  }

  onceExit(listener: ExitListener): void {
    this.child.once("exit", (code) => {
      listener(code, null);
    });
  }

  onceComplete(listener: ExitListener): void {
    this.child.once("exit", (code) => {
      listener(code, null);
    });
  }

  onceError(_listener: ErrorListener): void {
    // utilityProcess.fork throws synchronously for launch-time configuration errors.
  }

  terminate(): void {
    if (!this.child.kill()) {
      forceTerminatePid(this.child.pid);
    }
  }

  forceTerminate(): void {
    forceTerminatePid(this.child.pid);
  }
}

async function importElectronUtilityProcess(): Promise<{
  app: typeof import("electron").app;
  utilityProcess: typeof import("electron").utilityProcess;
}> {
  const electronModule = await import("electron");
  if (!("app" in electronModule) || !("utilityProcess" in electronModule)) {
    throw new Error("Electron utilityProcess is unavailable outside the Electron main process.");
  }

  return {
    app: electronModule.app,
    utilityProcess: electronModule.utilityProcess,
  };
}

export async function launchDesktopSubprocess(
  spec: DesktopSubprocessLaunchSpec,
): Promise<DesktopSubprocess> {
  if (spec.kind === "node") {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: buildSubprocessEnv(spec.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new NodeDesktopSubprocess(child);
  }

  const { app, utilityProcess } = await importElectronUtilityProcess();
  if (!app.isReady()) {
    throw new Error("Electron utilityProcess can only be launched after the app is ready.");
  }

  const options: ForkOptions = {
    cwd: spec.cwd,
    env: buildSubprocessEnv(spec.env),
    serviceName: spec.serviceName,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (process.platform === "darwin" && spec.allowLoadingUnsignedLibraries) {
    options.allowLoadingUnsignedLibraries = true;
  }

  return new UtilityDesktopSubprocess(utilityProcess.fork(spec.modulePath, spec.args, options));
}
