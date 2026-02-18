export interface MacPermissions {
  accessibility: boolean | null; // null = unknown
  screenRecording: boolean | null;
  instructions?: string;
}

export type MacPermissionKind = "accessibility" | "screenRecording";

export interface MacPermissionRequestResult {
  granted: boolean;
  instructions?: string;
}

/**
 * Check macOS Accessibility and Screen Recording permissions.
 * Returns definitive answers on macOS when running in Electron.
 * Returns { accessibility: true, screenRecording: true } on non-macOS.
 */
export function checkMacPermissions(): MacPermissions {
  if (process.platform !== "darwin") {
    return { accessibility: true, screenRecording: true };
  }

  let accessibility: boolean | null = null;
  let screenRecording: boolean | null = null;
  const instructions: string[] = [];

  try {
    // Dynamic require to avoid crashes outside Electron
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { systemPreferences } =
      require("electron") as typeof import("electron");

    // Accessibility: isTrustedAccessibilityClient({ prompt: false }) returns boolean
    // prompt: false means check without showing the system prompt
    accessibility = systemPreferences.isTrustedAccessibilityClient({
      prompt: false,
    });

    // Screen Recording: getMediaAccessStatus('screen') returns
    // 'granted' | 'denied' | 'not-determined' | 'restricted'
    const screenStatus = systemPreferences.getMediaAccessStatus("screen");
    screenRecording = screenStatus === "granted";

    if (!accessibility) {
      instructions.push(
        "Accessibility: Open System Settings > Privacy & Security > Accessibility, " +
          "then add Tyrum Desktop to the list and enable it.",
      );
    }
    if (!screenRecording) {
      instructions.push(
        "Screen Recording: Open System Settings > Privacy & Security > Screen Recording, " +
          "then add Tyrum Desktop to the list and enable it.",
      );
    }
  } catch {
    // Not running in Electron context (e.g., tests)
    // Return null = unknown
    instructions.push(
      "Permission status unknown (not running in Electron). " +
        "Open System Settings > Privacy & Security to check permissions.",
    );
  }

  const result: MacPermissions = {
    accessibility,
    screenRecording,
  };

  if (instructions.length > 0) {
    result.instructions = instructions.join("\n");
  }

  return result;
}

/**
 * Requests a specific macOS permission. This function is intentionally
 * user-initiated by UI action to avoid unexpected permission popups.
 */
export async function requestMacPermission(
  permission: MacPermissionKind,
): Promise<MacPermissionRequestResult> {
  if (process.platform !== "darwin") {
    return { granted: true };
  }

  try {
    // Dynamic require to avoid crashes outside Electron
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { systemPreferences, shell } =
      require("electron") as typeof import("electron");

    if (permission === "accessibility") {
      const granted = systemPreferences.isTrustedAccessibilityClient({
        prompt: true,
      });
      return granted
        ? { granted: true }
        : {
            granted: false,
            instructions:
              "Grant Accessibility in System Settings > Privacy & Security > Accessibility.",
          };
    }

    const screenStatus = systemPreferences.getMediaAccessStatus("screen");
    if (screenStatus === "granted") {
      return { granted: true };
    }

    // macOS does not expose a direct request prompt API for screen recording.
    // Opening the settings pane is the safest user-driven path.
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
    return {
      granted: false,
      instructions:
        "Opened Screen Recording settings. Enable Tyrum Desktop, then restart the app.",
    };
  } catch {
    return {
      granted: false,
      instructions:
        "Permission request unavailable outside Electron. Open System Settings > Privacy & Security manually.",
    };
  }
}
