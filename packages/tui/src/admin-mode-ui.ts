import type { AdminModeState } from "@tyrum/operator-core";

export function formatAdminModeRemaining(state: Pick<AdminModeState, "expiresAt" | "remainingMs">) {
  const remainingMs =
    state.remainingMs ??
    (state.expiresAt ? Math.max(0, Date.parse(state.expiresAt) - Date.now()) : null);
  if (remainingMs === null) return "--:--";

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
