import {
  formatAdminModeRemaining as formatAdminModeRemainingCore,
  type AdminModeState,
} from "@tyrum/operator-core";

export function formatAdminModeRemaining(state: Pick<AdminModeState, "expiresAt" | "remainingMs">) {
  return formatAdminModeRemainingCore(state);
}
