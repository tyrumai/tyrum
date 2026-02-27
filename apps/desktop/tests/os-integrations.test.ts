import { describe, expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "../src/main/updater.js";
import {
  configureMacAboutPanel,
  createDesktopUpdateOsIntegration,
} from "../src/main/platform/os-integrations.js";

function makeState(patch: Partial<DesktopUpdateState>): DesktopUpdateState {
  return {
    stage: "idle",
    currentVersion: "1.0.0",
    availableVersion: null,
    downloadedVersion: null,
    releaseDate: null,
    releaseNotes: null,
    progressPercent: null,
    message: null,
    checkedAt: null,
    ...patch,
  };
}

describe("configureMacAboutPanel", () => {
  it("uses app.setAboutPanelOptions on macOS", () => {
    const setAboutPanelOptions = vi.fn();
    const appStub = {
      getName: () => "Tyrum",
      getVersion: () => "1.2.3",
      setAboutPanelOptions,
    };

    configureMacAboutPanel(appStub, "darwin");

    expect(setAboutPanelOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationName: "Tyrum",
        applicationVersion: "1.2.3",
      }),
    );
  });

  it("does nothing on non-macOS platforms", () => {
    const setAboutPanelOptions = vi.fn();
    const appStub = {
      getName: () => "Tyrum",
      getVersion: () => "1.2.3",
      setAboutPanelOptions,
    };

    configureMacAboutPanel(appStub, "win32");

    expect(setAboutPanelOptions).not.toHaveBeenCalled();
  });
});

describe("createDesktopUpdateOsIntegration", () => {
  it("updates taskbar/dock progress during download", () => {
    const setProgressBar = vi.fn();
    const clearProgressBar = vi.fn();
    const notify = vi.fn();
    const integration = createDesktopUpdateOsIntegration({
      platform: "win32",
      setProgressBar,
      clearProgressBar,
      notify,
    });

    integration.onStateChange(makeState({ stage: "downloading", progressPercent: 41.2 }));

    expect(setProgressBar).toHaveBeenCalledWith(expect.closeTo(0.412, 5));

    integration.onStateChange(
      makeState({
        stage: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
        progressPercent: 100,
      }),
    );

    expect(clearProgressBar).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies when update becomes available and when it is ready to install", () => {
    const notify = vi.fn();
    const integration = createDesktopUpdateOsIntegration({
      platform: "darwin",
      setProgressBar: vi.fn(),
      clearProgressBar: vi.fn(),
      notify,
    });

    integration.onStateChange(makeState({ stage: "available", availableVersion: "1.2.0" }));
    integration.onStateChange(makeState({ stage: "available", availableVersion: "1.2.0" }));
    integration.onStateChange(
      makeState({
        stage: "downloaded",
        availableVersion: "1.2.0",
        downloadedVersion: "1.2.0",
        progressPercent: 100,
      }),
    );
    integration.onStateChange(
      makeState({
        stage: "downloaded",
        availableVersion: "1.2.0",
        downloadedVersion: "1.2.0",
        progressPercent: 100,
      }),
    );

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, "Update available", expect.stringContaining("1.2.0"));
    expect(notify).toHaveBeenNthCalledWith(
      2,
      "Update ready to install",
      expect.stringContaining("1.2.0"),
    );
  });
});
