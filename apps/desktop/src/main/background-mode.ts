import * as electron from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix as posixPath } from "node:path";
import type { DesktopNodeConfig } from "./config/schema.js";
import { loadConfig, saveConfig } from "./config/store.js";
import {
  startEmbeddedGatewayFromConfig,
  stopEmbeddedGatewayFromMainProcess,
} from "./ipc/gateway-ipc.js";
import type { GatewayStatus } from "./gateway-manager.js";
import type { NavigationRequest } from "./menu.js";

const BACKGROUND_LAUNCH_ARG = "--background";
const LINUX_AUTOSTART_FILENAME = "tyrum.desktop";
const MAC_TRAY_TEMPLATE_FILENAME = "macos-template.svg";

type LoginItemSettings = {
  openAtLogin?: boolean;
};

type AppLike = {
  isPackaged?: boolean;
  getAppPath?: () => string;
  getLoginItemSettings?: () => LoginItemSettings;
  setLoginItemSettings?: (settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    path?: string;
    args?: string[];
  }) => void;
  quit: () => void;
};

type MenuLike = {
  buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => Electron.Menu;
};

type TrayLike = {
  destroy: () => void;
  isDestroyed?: () => boolean;
  on: (event: string, listener: () => void) => void;
  setContextMenu: (menu: Electron.Menu) => void;
  setToolTip: (toolTip: string) => void;
};

type TrayConstructor = new (image: unknown, guid?: string) => TrayLike;

type NativeImageLike = {
  createFromDataURL: (dataUrl: string) => {
    setTemplateImage?: (template: boolean) => void;
  };
  createFromPath: (path: string) => unknown;
};

export type BackgroundModeState = {
  enabled: boolean;
  supported: boolean;
  trayAvailable: boolean;
  loginAutoStartActive: boolean;
  mode: DesktopNodeConfig["mode"];
};

export type BackgroundModeDependencies = {
  app?: AppLike;
  menu?: MenuLike;
  TrayCtor?: TrayConstructor;
  nativeImageImpl?: NativeImageLike;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  loadConfig?: () => DesktopNodeConfig;
  saveConfig?: (config: DesktopNodeConfig) => void;
  onShowMainWindow: () => void;
  onRequestNavigate: (request: NavigationRequest) => void;
  onStateChange?: (state: BackgroundModeState) => void;
  processArgv?: readonly string[];
  processExecPath?: string;
  resourcesPath?: string;
  moduleDir?: string;
};

function buildMacTrayIconDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function resolveMacTrayTemplatePath(input: {
  isPackaged: boolean;
  resourcesPath: string;
  moduleDir: string;
}): string {
  return input.isPackaged
    ? join(input.resourcesPath, "tray", MAC_TRAY_TEMPLATE_FILENAME)
    : join(input.moduleDir, "../../build/tray-macos-template.svg");
}

function quoteDesktopExecArg(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}

type AutoLaunchCommand = {
  command: string;
  args: string[];
};

function resolveAutoLaunchCommand(input: {
  electronApp: AppLike;
  processExecPath: string;
  isPackaged: boolean;
}): AutoLaunchCommand {
  if (!input.isPackaged && typeof input.electronApp.getAppPath === "function") {
    return {
      command: input.processExecPath,
      args: [input.electronApp.getAppPath(), BACKGROUND_LAUNCH_ARG],
    };
  }

  return {
    command: input.processExecPath,
    args: [BACKGROUND_LAUNCH_ARG],
  };
}

export function resolveLinuxAutostartPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const configHome = env["XDG_CONFIG_HOME"]?.trim() || posixPath.join(home, ".config");
  return posixPath.join(configHome, "autostart", LINUX_AUTOSTART_FILENAME);
}

export function renderLinuxAutostartEntry(command: AutoLaunchCommand): string {
  const exec = [command.command, ...command.args].map(quoteDesktopExecArg).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=Tyrum",
    "Comment=Start Tyrum in background mode",
    `Exec=${exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function isBackgroundLaunch(
  argv: readonly string[] = process.argv,
  flag = BACKGROUND_LAUNCH_ARG,
): boolean {
  return argv.includes(flag);
}

export class BackgroundModeController {
  private readonly electronApp: AppLike;
  private readonly menu: MenuLike;
  private readonly providedTrayCtor?: TrayConstructor;
  private readonly providedNativeImageImpl?: NativeImageLike;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly readConfig: () => DesktopNodeConfig;
  private readonly writeConfig: (config: DesktopNodeConfig) => void;
  private readonly onShowMainWindow: () => void;
  private readonly onRequestNavigate: (request: NavigationRequest) => void;
  private readonly onStateChange?: (state: BackgroundModeState) => void;
  private readonly processArgv: readonly string[];
  private readonly processExecPath: string;
  private readonly resourcesPath: string;
  private readonly moduleDir: string;
  private tray: TrayLike | null = null;
  private gatewayStatus: GatewayStatus = "stopped";
  private gatewayActionBusy = false;
  private state: BackgroundModeState = {
    enabled: false,
    supported: true,
    trayAvailable: false,
    loginAutoStartActive: false,
    mode: "embedded",
  };

  constructor(deps: BackgroundModeDependencies) {
    this.electronApp = deps.app ?? (electron.app as AppLike);
    this.menu = deps.menu ?? (electron.Menu as unknown as MenuLike);
    this.providedTrayCtor = deps.TrayCtor;
    this.providedNativeImageImpl = deps.nativeImageImpl;
    this.env = deps.env ?? process.env;
    this.platform = deps.platform ?? process.platform;
    this.readConfig = deps.loadConfig ?? (() => loadConfig());
    this.writeConfig = deps.saveConfig ?? ((config) => saveConfig(config));
    this.onShowMainWindow = deps.onShowMainWindow;
    this.onRequestNavigate = deps.onRequestNavigate;
    this.onStateChange = deps.onStateChange;
    this.processArgv = deps.processArgv ?? process.argv;
    this.processExecPath = deps.processExecPath ?? process.execPath;
    this.resourcesPath = deps.resourcesPath ?? process.resourcesPath;
    this.moduleDir = deps.moduleDir ?? import.meta.dirname;
  }

  initialize(config: DesktopNodeConfig = this.readConfig()): BackgroundModeState {
    try {
      return this.syncFromConfig(config);
    } catch (error) {
      this.syncAutoStart(false);
      this.state = {
        enabled: Boolean(config.background?.enabled),
        supported: false,
        trayAvailable: false,
        loginAutoStartActive: false,
        mode: config.mode,
      };
      this.onStateChange?.(this.getState());
      console.error("Failed to initialize background mode", error);
      return this.getState();
    }
  }

  getState(): BackgroundModeState {
    return { ...this.state };
  }

  shouldStartHiddenOnLaunch(): boolean {
    if (!isBackgroundLaunch(this.processArgv)) return false;
    if (!this.state.enabled) return false;
    if (this.state.mode !== "embedded") return false;
    return this.state.trayAvailable;
  }

  shouldHideOnClose(): boolean {
    return this.state.enabled && this.state.mode === "embedded" && this.state.trayAvailable;
  }

  setGatewayStatus(status: GatewayStatus): void {
    this.gatewayStatus = status;
    this.refreshTrayMenu();
  }

  setEnabled(enabled: boolean): BackgroundModeState {
    const current = this.readConfig();
    const next: DesktopNodeConfig = {
      ...current,
      background: {
        ...current.background,
        enabled,
      },
    };

    this.writeConfig(next);
    try {
      return this.syncFromConfig(next);
    } catch (error) {
      this.writeConfig(current);
      this.syncFromConfig(current);
      throw error;
    }
  }

  syncFromConfig(config: DesktopNodeConfig = this.readConfig()): BackgroundModeState {
    const enabled = Boolean(config.background?.enabled);
    const trayAvailable = enabled ? this.ensureTray() : this.destroyTrayAndReturnFalse();
    const loginAutoStartActive = this.syncAutoStart(enabled && config.mode === "embedded");
    const supported = this.platform === "linux" ? trayAvailable || !enabled : true;

    this.state = {
      enabled,
      supported,
      trayAvailable,
      loginAutoStartActive,
      mode: config.mode,
    };
    this.onStateChange?.(this.getState());
    return this.getState();
  }

  private destroyTrayAndReturnFalse(): false {
    this.destroyTray();
    return false;
  }

  private ensureTray(): boolean {
    if (this.tray && !this.tray.isDestroyed?.()) {
      this.refreshTrayMenu();
      return true;
    }

    try {
      const TrayCtor = this.getTrayCtor();
      this.tray = new TrayCtor(this.resolveTrayImage());
      this.tray.setToolTip("Tyrum");
      this.tray.on("click", () => {
        this.onShowMainWindow();
      });
      this.refreshTrayMenu();
      return true;
    } catch (error) {
      this.destroyTray();
      if (this.platform === "linux") {
        throw new Error(
          `Background mode requires a working system tray on Linux: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      throw error;
    }
  }

  private destroyTray(): void {
    if (!this.tray) return;
    try {
      this.tray.destroy();
    } catch {
      // ignore cleanup failures
    }
    this.tray = null;
  }

  private resolveTrayImage(): unknown {
    const nativeImageImpl = this.getNativeImageImpl();
    const isPackaged = this.electronApp.isPackaged === true;
    if (this.platform === "darwin") {
      const trayTemplateSvg = readFileSync(
        resolveMacTrayTemplatePath({
          isPackaged,
          resourcesPath: this.resourcesPath,
          moduleDir: this.moduleDir,
        }),
        "utf8",
      );
      const image = nativeImageImpl.createFromDataURL(buildMacTrayIconDataUrl(trayTemplateSvg));
      image.setTemplateImage?.(true);
      return image;
    }

    const assetPath = isPackaged
      ? join(this.resourcesPath, "tray", "32x32.png")
      : join(this.moduleDir, "../../build/icons/32x32.png");
    return nativeImageImpl.createFromPath(assetPath);
  }

  private getTrayCtor(): TrayConstructor {
    return (
      this.providedTrayCtor ?? ((electron as Record<string, unknown>)["Tray"] as TrayConstructor)
    );
  }

  private getNativeImageImpl(): NativeImageLike {
    return (
      this.providedNativeImageImpl ??
      ((electron as Record<string, unknown>)["nativeImage"] as NativeImageLike)
    );
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return;

    const startStopItem =
      this.gatewayStatus === "running" || this.gatewayStatus === "starting"
        ? {
            label: this.gatewayActionBusy ? "Stopping Gateway..." : "Stop Gateway",
            enabled: !this.gatewayActionBusy,
            click: () => {
              void this.stopGatewayFromTray();
            },
          }
        : {
            label: this.gatewayActionBusy ? "Starting Gateway..." : "Start Gateway",
            enabled: !this.gatewayActionBusy,
            click: () => {
              void this.startGatewayFromTray();
            },
          };

    const menu = this.menu.buildFromTemplate([
      {
        label: "Show Tyrum",
        click: () => {
          this.onShowMainWindow();
        },
      },
      { type: "separator" },
      {
        label: `Gateway: ${this.gatewayStatus}`,
        enabled: false,
      },
      startStopItem,
      {
        label: "Open Node Configuration",
        click: () => {
          this.onShowMainWindow();
          this.onRequestNavigate({ pageId: "desktop" });
        },
      },
      { type: "separator" },
      {
        label: "Quit Tyrum",
        click: () => {
          this.electronApp.quit();
        },
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  private async startGatewayFromTray(): Promise<void> {
    this.gatewayActionBusy = true;
    this.refreshTrayMenu();
    try {
      await startEmbeddedGatewayFromConfig();
    } finally {
      this.gatewayActionBusy = false;
      this.refreshTrayMenu();
    }
  }

  private async stopGatewayFromTray(): Promise<void> {
    this.gatewayActionBusy = true;
    this.refreshTrayMenu();
    try {
      await stopEmbeddedGatewayFromMainProcess();
    } finally {
      this.gatewayActionBusy = false;
      this.refreshTrayMenu();
    }
  }

  private syncAutoStart(enabled: boolean): boolean {
    if (this.platform === "linux") {
      return this.syncLinuxAutoStart(enabled);
    }
    if (this.platform === "darwin" || this.platform === "win32") {
      return this.syncLoginItemSettings(enabled);
    }
    return false;
  }

  private syncLoginItemSettings(enabled: boolean): boolean {
    if (typeof this.electronApp.setLoginItemSettings !== "function") {
      return false;
    }

    const command = resolveAutoLaunchCommand({
      electronApp: this.electronApp,
      processExecPath: this.processExecPath,
      isPackaged: this.electronApp.isPackaged ?? false,
    });

    this.electronApp.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled,
      path: command.command,
      args: command.args,
    });

    return Boolean(this.electronApp.getLoginItemSettings?.().openAtLogin ?? enabled);
  }

  private syncLinuxAutoStart(enabled: boolean): boolean {
    const autostartPath = resolveLinuxAutostartPath(this.env);
    if (!enabled) {
      rmSync(autostartPath, { force: true });
      return false;
    }

    const command = resolveAutoLaunchCommand({
      electronApp: this.electronApp,
      processExecPath: this.processExecPath,
      isPackaged: this.electronApp.isPackaged ?? false,
    });
    mkdirSync(dirname(autostartPath), { recursive: true });
    writeFileSync(autostartPath, renderLinuxAutostartEntry(command), {
      encoding: "utf8",
      mode: 0o600,
    });
    return existsSync(autostartPath);
  }
}

let backgroundModeController: BackgroundModeController | null = null;

export function setBackgroundModeController(controller: BackgroundModeController | null): void {
  backgroundModeController = controller;
}

export function getBackgroundModeController(): BackgroundModeController | null {
  return backgroundModeController;
}

export function notifyBackgroundConfigChanged(
  config?: DesktopNodeConfig,
): BackgroundModeState | null {
  return backgroundModeController?.syncFromConfig(config) ?? null;
}
