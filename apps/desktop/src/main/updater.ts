export type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface DesktopUpdateState {
  stage: UpdateStage;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  message: string | null;
  checkedAt: string | null;
}

export interface UpdateInfoLike {
  version?: string;
  releaseDate?: string | Date;
  releaseNotes?: unknown;
}

export interface ProgressInfoLike {
  percent?: number;
}

export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export interface DesktopUpdaterServiceOptions {
  appUpdater: AppUpdaterLike;
  currentVersion: string;
  isPackaged: boolean;
  onStateChange?: (state: DesktopUpdateState) => void;
}

const ALLOWED_RELEASE_FILE_SUFFIXES: Record<NodeJS.Platform, readonly string[]> = {
  darwin: [".dmg", ".zip"],
  win32: [".exe", ".msi"],
  aix: [".appimage", ".tar.gz"],
  android: [".appimage", ".tar.gz"],
  cygwin: [".appimage", ".tar.gz"],
  freebsd: [".appimage", ".tar.gz"],
  haiku: [".appimage", ".tar.gz"],
  linux: [".appimage", ".tar.gz"],
  netbsd: [".appimage", ".tar.gz"],
  openbsd: [".appimage", ".tar.gz"],
  sunos: [".appimage", ".tar.gz"],
};

function normalizeReleaseNotes(notes: unknown): string | null {
  if (typeof notes === "string") {
    const text = notes.trim();
    return text.length > 0 ? text : null;
  }

  if (!Array.isArray(notes)) {
    return null;
  }

  const chunks = notes
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { note?: unknown }).note === "string"
      ) {
        return ((entry as { note: string }).note || "").trim();
      }
      return "";
    })
    .filter((chunk) => chunk.length > 0);

  return chunks.length > 0 ? chunks.join("\n\n") : null;
}

function normalizeReleaseDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return trimmed;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown update error";
}

function clampPercent(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function releaseFileDialogExtensions(platform: NodeJS.Platform): readonly string[] {
  const suffixes = ALLOWED_RELEASE_FILE_SUFFIXES[platform] ?? [".appimage", ".tar.gz"];
  return suffixes
    .map((suffix) => (suffix.startsWith(".") ? suffix.slice(1) : suffix))
    .filter((suffix) => suffix.length > 0);
}

export function isAllowedReleaseFilePath(filePath: string, platform: NodeJS.Platform): boolean {
  const lower = filePath.trim().toLowerCase();
  if (lower.length === 0) return false;
  const suffixes = ALLOWED_RELEASE_FILE_SUFFIXES[platform] ?? [".appimage", ".tar.gz"];
  return suffixes.some((suffix) => lower.endsWith(suffix));
}

export class DesktopUpdaterService {
  private readonly appUpdater: AppUpdaterLike;
  private readonly isPackaged: boolean;
  private readonly onStateChange?: (state: DesktopUpdateState) => void;
  private startupCheckTriggered = false;
  private state: DesktopUpdateState;

  constructor(options: DesktopUpdaterServiceOptions) {
    this.appUpdater = options.appUpdater;
    this.isPackaged = options.isPackaged;
    this.onStateChange = options.onStateChange;

    this.state = {
      stage: "idle",
      currentVersion: options.currentVersion,
      availableVersion: null,
      downloadedVersion: null,
      releaseDate: null,
      releaseNotes: null,
      progressPercent: null,
      message: null,
      checkedAt: null,
    };

    this.appUpdater.autoDownload = false;
    this.appUpdater.autoInstallOnAppQuit = false;

    this.appUpdater.on("checking-for-update", () => {
      this.setState({
        stage: "checking",
        message: null,
        progressPercent: null,
      });
    });

    this.appUpdater.on("update-available", (info: unknown) => {
      const updateInfo = (info ?? {}) as UpdateInfoLike;
      this.setState({
        stage: "available",
        availableVersion: typeof updateInfo.version === "string" ? updateInfo.version : null,
        downloadedVersion: null,
        releaseDate: normalizeReleaseDate(updateInfo.releaseDate),
        releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes),
        progressPercent: null,
        message: null,
        checkedAt: nowIso(),
      });
    });

    this.appUpdater.on("update-not-available", () => {
      this.setState({
        stage: "not-available",
        availableVersion: null,
        downloadedVersion: null,
        releaseDate: null,
        releaseNotes: null,
        progressPercent: null,
        message: null,
        checkedAt: nowIso(),
      });
    });

    this.appUpdater.on("download-progress", (progress: unknown) => {
      const value = (progress ?? {}) as ProgressInfoLike;
      this.setState({
        stage: "downloading",
        progressPercent: clampPercent(value.percent),
        message: null,
      });
    });

    this.appUpdater.on("update-downloaded", (info: unknown) => {
      const updateInfo = (info ?? {}) as UpdateInfoLike;
      const resolvedVersion =
        typeof updateInfo.version === "string" ? updateInfo.version : this.state.availableVersion;
      this.setState({
        stage: "downloaded",
        downloadedVersion: resolvedVersion ?? null,
        progressPercent: 100,
        message: null,
      });
    });

    this.appUpdater.on("error", (error: unknown) => {
      this.setState({
        stage: "error",
        message: toErrorMessage(error),
        checkedAt: nowIso(),
      });
    });
  }

  getState(): DesktopUpdateState {
    return { ...this.state };
  }

  private setState(patch: Partial<DesktopUpdateState>): DesktopUpdateState {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    this.onStateChange?.(snapshot);
    return snapshot;
  }

  private ensurePackagedBuild(): void {
    if (this.isPackaged) return;
    throw new Error("Updates are only available in packaged desktop builds.");
  }

  assertInstallReady(): void {
    this.ensurePackagedBuild();
    if (this.state.stage !== "downloaded") {
      throw new Error("An update must be downloaded before install.");
    }
  }

  async checkForUpdates(): Promise<DesktopUpdateState> {
    this.ensurePackagedBuild();
    this.setState({
      stage: "checking",
      message: null,
      progressPercent: null,
    });
    await this.appUpdater.checkForUpdates();
    return this.getState();
  }

  async checkForUpdatesOnStartup(): Promise<void> {
    if (this.startupCheckTriggered) return;
    this.startupCheckTriggered = true;

    if (!this.isPackaged) return;

    try {
      await this.checkForUpdates();
    } catch (error) {
      this.setState({
        stage: "error",
        message: toErrorMessage(error),
        checkedAt: nowIso(),
      });
    }
  }

  async downloadUpdate(): Promise<DesktopUpdateState> {
    this.ensurePackagedBuild();

    if (this.state.stage !== "available" && this.state.stage !== "downloading") {
      throw new Error("No update is currently available to download.");
    }

    this.setState({
      stage: "downloading",
      progressPercent: 0,
      message: null,
    });
    await this.appUpdater.downloadUpdate();
    return this.getState();
  }

  installUpdate(): DesktopUpdateState {
    this.assertInstallReady();

    this.setState({
      stage: "installing",
      message: null,
    });
    this.appUpdater.quitAndInstall(false, true);
    return this.getState();
  }
}
