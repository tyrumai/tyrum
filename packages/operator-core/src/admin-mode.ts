import type { ExternalStore } from "./store.js";
import type { AdminModeState } from "./stores/admin-mode-store.js";

export class AdminModeRequiredError extends Error {
  readonly code = "admin_mode_required";

  constructor(message = "Admin Mode is required.") {
    super(message);
    this.name = "AdminModeRequiredError";
  }
}

export function isAdminModeActive(state: AdminModeState): boolean {
  if (state.status !== "active") return false;
  if (!state.elevatedToken) return false;
  if (!state.expiresAt) return false;
  if (state.remainingMs !== null && state.remainingMs <= 0) return false;
  return true;
}

export function requireAdminMode(state: AdminModeState): void {
  if (isAdminModeActive(state)) return;
  throw new AdminModeRequiredError();
}

export async function gateAdminMode<T>(
  store: ExternalStore<AdminModeState>,
  fn: () => Promise<T>,
): Promise<T> {
  requireAdminMode(store.getSnapshot());
  return await fn();
}
