export interface MacPermissions {
  accessibility: boolean | null; // null = unknown
  screenRecording: boolean | null;
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

  return {
    accessibility,
    screenRecording,
    instructions: instructions.length > 0 ? instructions.join("\n") : undefined,
  };
}
