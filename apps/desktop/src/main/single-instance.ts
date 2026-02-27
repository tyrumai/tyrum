export const TYRUM_DESKTOP_APP_USER_MODEL_ID = "net.tyrum.desktop";

type AppIdentity = {
  setAppUserModelId?: (id: string) => void;
};

type ElectronApp = {
  requestSingleInstanceLock: () => boolean;
  on: (
    event: "second-instance",
    handler: (event: unknown, argv: string[], workingDirectory: string) => void,
  ) => void;
  quit: () => void;
};

type FocusableWindow = {
  isMinimized?: () => boolean;
  restore?: () => void;
  show?: () => void;
  focus?: () => void;
};

let lastSecondInstanceArgv: string[] | null = null;

export function getLastSecondInstanceArgv(): readonly string[] | null {
  return lastSecondInstanceArgv;
}

export function clearLastSecondInstanceArgv(): void {
  lastSecondInstanceArgv = null;
}

export function setWindowsAppUserModelId(app: AppIdentity): void {
  if (process.platform !== "win32") {
    return;
  }

  app.setAppUserModelId?.(TYRUM_DESKTOP_APP_USER_MODEL_ID);
}

function focusMainWindow(window: FocusableWindow | null): void {
  if (!window) {
    return;
  }

  if (window.isMinimized?.()) {
    window.restore?.();
  }

  window.show?.();
  window.focus?.();
}

export function setupSingleInstance(deps: {
  app: ElectronApp;
  getMainWindow: () => FocusableWindow | null;
}): boolean {
  const didAcquireLock = deps.app.requestSingleInstanceLock();
  if (!didAcquireLock) {
    deps.app.quit();
    return false;
  }

  deps.app.on("second-instance", (_event, argv) => {
    lastSecondInstanceArgv = argv;
    focusMainWindow(deps.getMainWindow());
  });

  return true;
}
