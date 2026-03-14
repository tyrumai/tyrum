import type { BrowserWindow } from "electron";
import Store from "electron-store";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowState = {
  bounds: WindowBounds;
  isMaximized: boolean;
};

const WINDOW_STATE_FILENAME = "window-state.json";

function getWindowStatePath(userDataPath: string): string {
  return join(userDataPath, WINDOW_STATE_FILENAME);
}

function createWindowStateStore(userDataPath: string): Store<Record<string, unknown>> {
  return new Store<Record<string, unknown>>({
    cwd: userDataPath,
    name: "window-state",
    configFileMode: 0o600,
    clearInvalidConfig: false,
    serialize: (value) => `${JSON.stringify(value, null, 2)}\n`,
    deserialize: (value) => JSON.parse(value) as Record<string, unknown>,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBounds(value: unknown): WindowBounds | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = value["x"];
  const y = value["y"];
  const width = value["width"];
  const height = value["height"];

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

export function loadWindowState(userDataPath: string): WindowState | null {
  const path = getWindowStatePath(userDataPath);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = createWindowStateStore(userDataPath).store as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const bounds = parseBounds(parsed["bounds"]);
    const isMaximized = parsed["isMaximized"];
    if (!bounds || typeof isMaximized !== "boolean") {
      return null;
    }

    return { bounds, isMaximized };
  } catch (err) {
    console.warn("Failed to load window state", err);
    return null;
  }
}

export function saveWindowState(userDataPath: string, state: WindowState): void {
  try {
    createWindowStateStore(userDataPath).store = state as Record<string, unknown>;
  } catch (err) {
    console.error("Failed to save window state", err);
  }
}

export function captureWindowState(
  window: BrowserWindow,
  options?: { isMaximized?: boolean },
): WindowState {
  const isMaximized = options?.isMaximized ?? window.isMaximized();
  const bounds = window.getNormalBounds();
  return {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    isMaximized,
  };
}

function intersectsBounds(a: WindowBounds, b: WindowBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ensureVisibleBounds(
  bounds: WindowBounds,
  displayWorkAreas: readonly WindowBounds[],
): WindowBounds {
  if (displayWorkAreas.length === 0) {
    return bounds;
  }

  const isVisible = displayWorkAreas.some((workArea) => intersectsBounds(bounds, workArea));
  if (isVisible) {
    return bounds;
  }

  const primaryWorkArea = displayWorkAreas.at(0);
  if (!primaryWorkArea) {
    return bounds;
  }
  const effectiveWidth = Math.min(bounds.width, primaryWorkArea.width);
  const effectiveHeight = Math.min(bounds.height, primaryWorkArea.height);
  const maxX = primaryWorkArea.x + primaryWorkArea.width - effectiveWidth;
  const maxY = primaryWorkArea.y + primaryWorkArea.height - effectiveHeight;

  return {
    ...bounds,
    width: effectiveWidth,
    height: effectiveHeight,
    x: clamp(bounds.x, primaryWorkArea.x, maxX),
    y: clamp(bounds.y, primaryWorkArea.y, maxY),
  };
}
