import { describe, expect, it, vi } from "vitest";
import {
  BackgroundModeController,
  isBackgroundLaunch,
  renderLinuxAutostartEntry,
  resolveLinuxAutostartPath,
} from "../src/main/background-mode.js";
import { DEFAULT_CONFIG, type DesktopNodeConfig } from "../src/main/config/schema.js";

vi.mock("electron", () => ({
  app: {
    quit: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
  },
  Tray: class {
    destroy = vi.fn();
    isDestroyed = vi.fn(() => false);
    on = vi.fn();
    setContextMenu = vi.fn();
    setToolTip = vi.fn();
  },
  nativeImage: {
    createFromDataURL: vi.fn(() => ({ setTemplateImage: vi.fn() })),
    createFromPath: vi.fn(() => ({})),
  },
}));

function createController(options?: {
  platform?: NodeJS.Platform;
  config?: DesktopNodeConfig;
  nativeImageImpl?: {
    createFromDataURL: (dataUrl: string) => { setTemplateImage?: (template: boolean) => void };
    createFromPath: (path: string) => unknown;
  };
}) {
  let config = options?.config ?? DEFAULT_CONFIG;
  const menu = {
    buildFromTemplate: vi.fn(() => ({}) as Electron.Menu),
  };
  let openAtLogin = false;
  const app = {
    isPackaged: true,
    getAppPath: vi.fn(() => "/tmp/Tyrum.app"),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin })),
    setLoginItemSettings: vi.fn((settings: { openAtLogin: boolean }) => {
      openAtLogin = settings.openAtLogin;
    }),
    quit: vi.fn(),
  };

  const controller = new BackgroundModeController({
    app,
    menu,
    nativeImageImpl: options?.nativeImageImpl ?? {
      createFromDataURL: vi.fn(() => ({ setTemplateImage: vi.fn() })),
      createFromPath: vi.fn(() => ({})),
    },
    platform: options?.platform ?? "win32",
    processArgv: ["Tyrum", "--background"],
    processExecPath: "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
    resourcesPath: "/Applications/Tyrum.app/Contents/Resources",
    loadConfig: () => config,
    saveConfig: (nextConfig) => {
      config = nextConfig;
    },
    onShowMainWindow: vi.fn(),
    onRequestNavigate: vi.fn(),
  });

  return { app, controller, menu };
}

describe("background mode helpers", () => {
  it("detects background launch args", () => {
    expect(isBackgroundLaunch(["Tyrum", "--background"])).toBe(true);
    expect(isBackgroundLaunch(["Tyrum", "--dev"])).toBe(false);
  });

  it("resolves the Linux autostart path under XDG_CONFIG_HOME", () => {
    expect(
      resolveLinuxAutostartPath(
        {
          XDG_CONFIG_HOME: "/tmp/xdg-config",
        },
        "/tmp/home",
      ),
    ).toBe("/tmp/xdg-config/autostart/tyrum.desktop");
  });

  it("renders a Linux autostart entry with the background arg", () => {
    expect(
      renderLinuxAutostartEntry({
        command: "/opt/Tyrum/Tyrum",
        args: ["--background"],
      }),
    ).toContain('Exec="/opt/Tyrum/Tyrum" "--background"');
  });
});

describe("BackgroundModeController", () => {
  it("enables tray + login item settings for embedded mode on Windows", () => {
    const { app, controller, menu } = createController();

    const state = controller.setEnabled(true);

    expect(state).toMatchObject({
      enabled: true,
      trayAvailable: true,
      loginAutoStartActive: true,
      mode: "embedded",
    });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        openAtLogin: true,
        openAsHidden: true,
        args: ["--background"],
      }),
    );
    expect(menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(controller.shouldStartHiddenOnLaunch()).toBe(true);
    expect(controller.shouldHideOnClose()).toBe(true);
  });

  it("keeps tray enabled but disables login auto start for remote mode", () => {
    const { app, controller } = createController({
      config: {
        ...DEFAULT_CONFIG,
        mode: "remote",
        background: { enabled: true },
      },
    });

    const state = controller.initialize();

    expect(state).toMatchObject({
      enabled: true,
      trayAvailable: true,
      loginAutoStartActive: false,
      mode: "remote",
    });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        openAtLogin: false,
      }),
    );
    expect(controller.shouldHideOnClose()).toBe(false);
  });

  it("fails closed when Linux tray creation is unavailable", () => {
    const { controller } = createController({
      platform: "linux",
      nativeImageImpl: {
        createFromDataURL: vi.fn(() => ({ setTemplateImage: vi.fn() })),
        createFromPath: vi.fn(() => {
          throw new Error("StatusNotifier unavailable");
        }),
      },
    });

    expect(() => controller.setEnabled(true)).toThrow("system tray");
  });
});
