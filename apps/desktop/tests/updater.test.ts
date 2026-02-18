import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopUpdaterService,
  isAllowedReleaseFilePath,
  releaseFileDialogExtensions,
  type AppUpdaterLike,
} from "../src/main/updater.js";

class FakeUpdater extends EventEmitter implements AppUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  readonly checkForUpdatesMock = vi.fn(async () => undefined);
  readonly downloadUpdateMock = vi.fn(async () => undefined);
  readonly quitAndInstallMock = vi.fn();

  checkForUpdates = () => this.checkForUpdatesMock();
  downloadUpdate = () => this.downloadUpdateMock();
  quitAndInstall = (isSilent?: boolean, isForceRunAfter?: boolean) => {
    this.quitAndInstallMock(isSilent, isForceRunAfter);
  };
}

describe("DesktopUpdaterService", () => {
  it("starts idle and configures updater defaults", () => {
    const updater = new FakeUpdater();
    const service = new DesktopUpdaterService({
      appUpdater: updater,
      currentVersion: "1.0.0",
      isPackaged: true,
    });

    expect(service.getState()).toMatchObject({
      stage: "idle",
      currentVersion: "1.0.0",
      availableVersion: null,
    });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("fails update checks in non-packaged builds", async () => {
    const service = new DesktopUpdaterService({
      appUpdater: new FakeUpdater(),
      currentVersion: "1.0.0",
      isPackaged: false,
    });

    await expect(service.checkForUpdates()).rejects.toThrow(
      "packaged desktop builds",
    );
  });

  it("updates state from updater events", async () => {
    const updater = new FakeUpdater();
    const service = new DesktopUpdaterService({
      appUpdater: updater,
      currentVersion: "1.0.0",
      isPackaged: true,
    });

    await service.checkForUpdates();
    updater.emit("update-available", {
      version: "1.1.0",
      releaseDate: "2026-02-18T00:00:00.000Z",
      releaseNotes: "Bug fixes",
    });

    expect(service.getState()).toMatchObject({
      stage: "available",
      availableVersion: "1.1.0",
      releaseNotes: "Bug fixes",
    });

    await service.downloadUpdate();
    updater.emit("download-progress", { percent: 41.2 });
    updater.emit("update-downloaded", { version: "1.1.0" });

    expect(service.getState()).toMatchObject({
      stage: "downloaded",
      downloadedVersion: "1.1.0",
      progressPercent: 100,
    });
  });

  it("requires downloaded state before install", () => {
    const updater = new FakeUpdater();
    const service = new DesktopUpdaterService({
      appUpdater: updater,
      currentVersion: "1.0.0",
      isPackaged: true,
    });

    expect(() => service.installUpdate()).toThrow("must be downloaded");
  });

  it("invokes quitAndInstall after download", () => {
    const updater = new FakeUpdater();
    const service = new DesktopUpdaterService({
      appUpdater: updater,
      currentVersion: "1.0.0",
      isPackaged: true,
    });

    updater.emit("update-available", { version: "1.1.0" });
    updater.emit("update-downloaded", { version: "1.1.0" });
    service.installUpdate();

    expect(updater.quitAndInstallMock).toHaveBeenCalledWith(false, true);
  });
});

describe("release file validation", () => {
  it("accepts expected release file suffixes by platform", () => {
    expect(isAllowedReleaseFilePath("/tmp/Tyrum.dmg", "darwin")).toBe(true);
    expect(isAllowedReleaseFilePath("C:/temp/Tyrum.exe", "win32")).toBe(true);
    expect(isAllowedReleaseFilePath("/tmp/Tyrum.AppImage", "linux")).toBe(true);
    expect(isAllowedReleaseFilePath("/tmp/Tyrum.zip", "linux")).toBe(false);
  });

  it("returns reasonable dialog extension hints", () => {
    const linuxExtensions = releaseFileDialogExtensions("linux");
    expect(linuxExtensions).toContain("appimage");
    expect(linuxExtensions).toContain("tar.gz");
    expect(linuxExtensions).not.toContain("tar");
    expect(linuxExtensions).not.toContain("gz");
    expect(releaseFileDialogExtensions("darwin")).toContain("dmg");
  });
});
