import type { DesktopUpdateState } from "../updater.js";

export interface AboutPanelAppLike {
  getName: () => string;
  getVersion: () => string;
  setAboutPanelOptions?: (options: Record<string, unknown>) => void;
}

export function configureMacAboutPanel(app: AboutPanelAppLike, platform: NodeJS.Platform): void {
  if (platform !== "darwin") return;
  if (typeof app.setAboutPanelOptions !== "function") return;

  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
  });
}

export interface DesktopUpdateOsIntegrationOptions {
  platform: NodeJS.Platform;
  setProgressBar: (progress: number) => void;
  clearProgressBar: () => void;
  notify: (title: string, body: string) => void;
}

export interface DesktopUpdateOsIntegration {
  onStateChange: (state: DesktopUpdateState) => void;
}

export function createDesktopUpdateOsIntegration(
  options: DesktopUpdateOsIntegrationOptions,
): DesktopUpdateOsIntegration {
  const shouldShowProgress = options.platform === "win32" || options.platform === "darwin";
  let progressActive = false;
  let lastAvailableNotifiedVersion: string | null = null;
  let lastDownloadedNotifiedVersion: string | null = null;
  let notifiedAvailableWithoutVersion = false;
  let notifiedDownloadedWithoutVersion = false;

  return {
    onStateChange: (state) => {
      if (shouldShowProgress) {
        if (state.stage === "downloading") {
          const percent =
            typeof state.progressPercent === "number" && !Number.isNaN(state.progressPercent)
              ? state.progressPercent
              : 0;
          const clamped = Math.min(100, Math.max(0, percent));
          options.setProgressBar(clamped / 100);
          progressActive = true;
        } else if (progressActive) {
          options.clearProgressBar();
          progressActive = false;
        }
      }

      if (state.stage === "available") {
        if (state.availableVersion === null) {
          if (!notifiedAvailableWithoutVersion) {
            notifiedAvailableWithoutVersion = true;
            options.notify("Update available", "An update is available to download.");
          }
        } else if (state.availableVersion !== lastAvailableNotifiedVersion) {
          lastAvailableNotifiedVersion = state.availableVersion;
          options.notify(
            "Update available",
            `Version ${state.availableVersion} is available to download.`,
          );
        }
      }

      if (state.stage === "downloaded") {
        if (state.downloadedVersion === null) {
          if (!notifiedDownloadedWithoutVersion) {
            notifiedDownloadedWithoutVersion = true;
            options.notify("Update ready to install", "An update is ready to install.");
          }
        } else if (state.downloadedVersion !== lastDownloadedNotifiedVersion) {
          lastDownloadedNotifiedVersion = state.downloadedVersion;
          options.notify(
            "Update ready to install",
            `Version ${state.downloadedVersion} is ready to install.`,
          );
        }
      }
    },
  };
}
