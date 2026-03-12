import { useMemo } from "react";
import { useHostApiOptional, type OperatorUiHostApi } from "../host/host-api.js";

function navigatorClipboardAvailable(): boolean {
  return typeof globalThis.navigator?.clipboard?.writeText === "function";
}

export function canWriteTextToClipboard(host: OperatorUiHostApi | null): boolean {
  if (host?.kind === "mobile" && host.api.clipboard) {
    return true;
  }
  return navigatorClipboardAvailable();
}

export async function writeTextToClipboard(
  text: string,
  host: OperatorUiHostApi | null,
): Promise<void> {
  if (host?.kind === "mobile" && host.api.clipboard) {
    await host.api.clipboard.writeText(text);
    return;
  }

  if (!navigatorClipboardAvailable()) {
    throw new Error("Clipboard API unavailable.");
  }

  await globalThis.navigator.clipboard.writeText(text);
}

export function useClipboard() {
  const host = useHostApiOptional();
  const canWrite = canWriteTextToClipboard(host);

  return useMemo(
    () => ({
      canWrite,
      writeText: async (text: string) => await writeTextToClipboard(text, host),
    }),
    [canWrite, host],
  );
}
