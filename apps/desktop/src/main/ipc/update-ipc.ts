import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type FileFilter,
  type OpenDialogOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  DesktopUpdaterService,
  isAllowedReleaseFilePath,
  releaseFileDialogExtensions,
} from "../updater.js";
import { createWindowSender } from "./window-sender.js";

const sender = createWindowSender();

let updater: DesktopUpdaterService | null = null;
let ipcRegistered = false;
let dialogWindow: BrowserWindow | null = null;

export interface ManualReleaseFileResult {
  opened: boolean;
  path: string | null;
  message: string | null;
}

export interface UpdateIpcOptions {
  beforeInstall?: () => Promise<void>;
  allowQuitForUpdate?: () => void;
  clearQuitForUpdate?: () => void;
}

function ensureUpdater(): DesktopUpdaterService {
  if (updater) {
    return updater;
  }

  updater = new DesktopUpdaterService({
    appUpdater: autoUpdater as unknown as ConstructorParameters<
      typeof DesktopUpdaterService
    >[0]["appUpdater"],
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    onStateChange: (state) => {
      sender.send("update:state", state);
    },
  });

  return updater;
}

function buildReleaseFileFilters(platform: NodeJS.Platform): FileFilter[] {
  const extensions = [...releaseFileDialogExtensions(platform)];
  const name =
    platform === "darwin"
      ? "macOS Installers"
      : platform === "win32"
        ? "Windows Installers"
        : "Linux Packages";

  return [{ name, extensions }];
}

async function openReleaseFileFromDisk(): Promise<ManualReleaseFileResult> {
  const dialogOptions: OpenDialogOptions = {
    title: "Select Tyrum Desktop Release File",
    buttonLabel: "Open Installer",
    properties: ["openFile"],
    filters: buildReleaseFileFilters(process.platform),
  };
  const result = dialogWindow
    ? await dialog.showOpenDialog(dialogWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return {
      opened: false,
      path: null,
      message: "No release file selected.",
    };
  }

  const selectedPath = result.filePaths[0]!;
  if (!isAllowedReleaseFilePath(selectedPath, process.platform)) {
    throw new Error("Selected file type is not a supported installer package.");
  }

  const openResult = await shell.openPath(selectedPath);
  const openError =
    typeof openResult === "string" ? openResult : String(openResult ?? "");
  if (openError.trim().length > 0) {
    throw new Error(openError);
  }

  return {
    opened: true,
    path: selectedPath,
    message: "Installer opened. Complete installation, then relaunch Tyrum Desktop.",
  };
}

export function registerUpdateIpc(
  window: BrowserWindow,
  options: UpdateIpcOptions = {},
): void {
  sender.setWindow(window);
  dialogWindow = window;

  const service = ensureUpdater();
  sender.send("update:state", service.getState());

  if (!ipcRegistered) {
    ipcRegistered = true;

    ipcMain.handle("updates:state", () => service.getState());

    ipcMain.handle("updates:check", async () => service.checkForUpdates());

    ipcMain.handle("updates:download", async () => service.downloadUpdate());

    ipcMain.handle("updates:install", async () => {
      service.assertInstallReady();
      await options.beforeInstall?.();
      try {
        options.allowQuitForUpdate?.();
        return service.installUpdate();
      } catch (error) {
        options.clearQuitForUpdate?.();
        throw error;
      }
    });

    ipcMain.handle("updates:open-release-file", async () => {
      return openReleaseFileFromDisk();
    });
  }

  void service.checkForUpdatesOnStartup();
}
