import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, clipboard } from "electron";
import type { DesktopBackend, ScreenCapture } from "@tyrum/desktop-node";
import { checkMacPermissions, type MacPermissions } from "../../platform/permissions.js";
import {
  launchDesktopSubprocess,
  type DesktopSubprocessLaunchSpec,
} from "../../desktop-subprocess.js";

const DEFAULT_CAPTURE_TIMEOUT_MS = 15_000;
const MAC_SCREEN_RECORDING_ERROR =
  "Desktop screenshot unavailable: macOS Screen Recording permission is required. Use Diagnostics to grant Screen Recording access and restart Tyrum.";

type DesktopDisplayTarget = "primary" | "all" | { id: string };

type HelperSuccess = {
  ok: true;
  width: number;
  height: number;
  bytesBase64: string;
};

type HelperFailure = {
  ok: false;
  error: string;
};

type HelperResponse = HelperSuccess | HelperFailure;

export interface ResolveDesktopScreenshotHelperPathOptions {
  moduleDir?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  exists?: (path: string) => boolean;
}

export interface ResolveDesktopScreenshotHelperLaunchOptions {
  helperPath: string;
  processExecPath?: string;
  versions?: NodeJS.ProcessVersions;
}

export interface IsolatedDesktopBackendOptions {
  helperPath?: string;
  moduleDir?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  exists?: (path: string) => boolean;
  processExecPath?: string;
  versions?: NodeJS.ProcessVersions;
  env?: NodeJS.ProcessEnv;
  captureTimeoutMs?: number;
  macPermissions?: () => MacPermissions;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message;
    if (error.name) return error.name;
    return "Error";
  }
  return typeof error === "string" ? error : String(error);
}

function parseHelperResponse(rawOutput: string): HelperResponse | null {
  const lines = rawOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1);
  if (!lastLine) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastLine) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const ok = (parsed as { ok?: unknown }).ok;
  if (ok === true) {
    const { width, height, bytesBase64 } = parsed as {
      width?: unknown;
      height?: unknown;
      bytesBase64?: unknown;
    };
    if (
      typeof width === "number" &&
      typeof height === "number" &&
      typeof bytesBase64 === "string"
    ) {
      return { ok: true, width, height, bytesBase64 };
    }
    return null;
  }

  if (ok === false) {
    const { error } = parsed as { error?: unknown };
    if (typeof error === "string" && error.trim().length > 0) {
      return { ok: false, error };
    }
  }

  return null;
}

function trimOutput(rawOutput: string): string | null {
  const trimmed = rawOutput.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveDesktopScreenshotHelperPath(
  options: ResolveDesktopScreenshotHelperPathOptions = {},
): string {
  const moduleDir = options.moduleDir ?? import.meta.dirname;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const exists = options.exists ?? existsSync;

  const candidates = [join(moduleDir, "desktop-screenshot-helper.mjs")];
  if (isPackaged) {
    candidates.push(
      join(resourcesPath, "app.asar", "dist", "main", "desktop-screenshot-helper.mjs"),
    );
  }
  candidates.push(join(moduleDir, "../../../../dist/main/desktop-screenshot-helper.mjs"));

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate desktop screenshot helper. Tried:\n- ${candidates.join("\n- ")}`,
  );
}

export function resolveDesktopScreenshotHelperLaunchSpec(
  options: ResolveDesktopScreenshotHelperLaunchOptions,
): DesktopSubprocessLaunchSpec {
  const processExecPath = options.processExecPath ?? process.execPath;
  const versions = options.versions ?? process.versions;
  if (typeof versions.electron === "string" && versions.electron.length > 0) {
    return {
      kind: "utility",
      modulePath: options.helperPath,
      args: [],
      env: {},
      serviceName: "Tyrum Screenshot Helper",
      allowLoadingUnsignedLibraries: true,
    };
  }

  return {
    kind: "node",
    command: processExecPath,
    args: [options.helperPath],
    env: {},
  };
}

function applyDesktopScreenshotHelperArgs(
  launch: DesktopSubprocessLaunchSpec,
  display: DesktopDisplayTarget,
  env: NodeJS.ProcessEnv | undefined,
): DesktopSubprocessLaunchSpec {
  const payload = JSON.stringify({ display });
  const baseEnv =
    env === undefined
      ? {}
      : Object.fromEntries(
          Object.entries(env).flatMap(([key, value]) =>
            typeof value === "string" ? [[key, value]] : [],
          ),
        );

  if (launch.kind === "node") {
    return {
      ...launch,
      args: [...launch.args, payload],
      env: {
        ...baseEnv,
        ...launch.env,
      },
    };
  }

  return {
    ...launch,
    args: [payload],
    env: {
      ...baseEnv,
      ...launch.env,
    },
  };
}

export class IsolatedDesktopBackend implements DesktopBackend {
  readonly supportsClipboardWrite = true;

  constructor(
    private readonly delegate: DesktopBackend,
    private readonly options: IsolatedDesktopBackendOptions = {},
  ) {}

  async captureScreen(display: DesktopDisplayTarget): Promise<ScreenCapture> {
    this.ensureMacScreenRecordingPermission();

    const helperPath =
      this.options.helperPath ??
      resolveDesktopScreenshotHelperPath({
        moduleDir: this.options.moduleDir,
        isPackaged: this.options.isPackaged,
        resourcesPath: this.options.resourcesPath,
        exists: this.options.exists,
      });
    const launch = resolveDesktopScreenshotHelperLaunchSpec({
      helperPath,
      processExecPath: this.options.processExecPath,
      versions: this.options.versions,
    });
    const helperLaunch = applyDesktopScreenshotHelperArgs(launch, display, {
      ...process.env,
      ...this.options.env,
    });
    const helper = await launchDesktopSubprocess(helperLaunch);
    const timeoutMs = this.options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;

    return await new Promise<ScreenCapture>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const rejectOnce = (message: string): void => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };

      const resolveOnce = (capture: ScreenCapture): void => {
        if (settled) return;
        settled = true;
        resolve(capture);
      };

      if (!helper.stdout || !helper.stderr) {
        rejectOnce("Screen capture helper stdio was not available");
        return;
      }

      const timer = setTimeout(() => {
        helper.forceTerminate();
        rejectOnce(`Screen capture helper timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      helper.onceError((error) => {
        clearTimeout(timer);
        rejectOnce(`Failed to start screen capture helper: ${toErrorMessage(error)}`);
      });

      helper.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      helper.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      helper.onceComplete((code, signal) => {
        clearTimeout(timer);

        const response = parseHelperResponse(stdout);
        if (response) {
          if (response.ok) {
            resolveOnce({
              width: response.width,
              height: response.height,
              buffer: Buffer.from(response.bytesBase64, "base64"),
            });
            return;
          }
          rejectOnce(response.error);
          return;
        }

        const stderrText = trimOutput(stderr);
        const stdoutText = trimOutput(stdout);
        if (signal) {
          rejectOnce(
            `Screen capture helper exited with signal ${signal}${stderrText ? `: ${stderrText}` : ""}`,
          );
          return;
        }
        if (typeof code === "number" && code !== 0) {
          rejectOnce(
            `Screen capture helper exited with code ${String(code)}${
              stderrText ? `: ${stderrText}` : ""
            }`,
          );
          return;
        }
        if (stderrText) {
          rejectOnce(`Screen capture helper returned no result: ${stderrText}`);
          return;
        }
        if (stdoutText) {
          rejectOnce(`Screen capture helper returned invalid output: ${stdoutText}`);
          return;
        }
        rejectOnce("Screen capture helper returned no result");
      });
    });
  }

  async writeClipboardText(text: string): Promise<void> {
    try {
      clipboard.writeText(text);
    } catch {
      throw new Error("Clipboard write failed");
    }
  }

  async moveMouse(x: number, y: number): Promise<void> {
    await this.delegate.moveMouse(x, y);
  }

  async clickMouse(x: number, y: number, button?: "left" | "right" | "middle"): Promise<void> {
    await this.delegate.clickMouse(x, y, button);
  }

  async doubleClickMouse(
    x: number,
    y: number,
    button?: "left" | "right" | "middle",
  ): Promise<void> {
    await this.delegate.doubleClickMouse(x, y, button);
  }

  async dragMouse(x: number, y: number, duration_ms?: number): Promise<void> {
    await this.delegate.dragMouse(x, y, duration_ms);
  }

  async typeText(text: string): Promise<void> {
    await this.delegate.typeText(text);
  }

  async pressKey(key: string): Promise<void> {
    await this.delegate.pressKey(key);
  }

  private ensureMacScreenRecordingPermission(): void {
    if (process.platform !== "darwin") return;
    const permissions = (this.options.macPermissions ?? checkMacPermissions)();
    if (permissions.screenRecording === true) return;
    throw new Error(MAC_SCREEN_RECORDING_ERROR);
  }
}
