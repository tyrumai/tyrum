import type { ExternalStore } from "./store.js";
import type { ElevatedModeState } from "./stores/elevated-mode-store.js";

export class ElevatedModeRequiredError extends Error {
  readonly code = "elevated_mode_required";

  constructor(message = "Elevated Mode is required.") {
    super(message);
    this.name = "ElevatedModeRequiredError";
  }
}

export function isElevatedModeActive(state: ElevatedModeState): boolean {
  if (state.status !== "active") return false;
  if (!state.elevatedToken) return false;
  if (state.remainingMs !== null && state.remainingMs <= 0) return false;
  return true;
}

export function requireElevatedMode(state: ElevatedModeState): void {
  if (isElevatedModeActive(state)) return;
  throw new ElevatedModeRequiredError();
}

export async function gateElevatedMode<T>(
  store: ExternalStore<ElevatedModeState>,
  fn: () => Promise<T>,
): Promise<T> {
  requireElevatedMode(store.getSnapshot());
  return await fn();
}

export function formatElevatedModeRemaining(
  state: Pick<ElevatedModeState, "expiresAt" | "remainingMs">,
) {
  const remainingMs =
    state.remainingMs ??
    (state.expiresAt ? Math.max(0, Date.parse(state.expiresAt) - Date.now()) : null);
  if (remainingMs === null) return "--:--";

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
