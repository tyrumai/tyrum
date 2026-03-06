export function formatFatalErrorForConsole(error: unknown): string {
  const safeToString = (value: unknown): string => {
    try {
      return String(value);
    } catch {
      return "[unstringifiable]";
    }
  };

  const safeJsonStringify = (value: unknown): string | undefined => {
    try {
      return JSON.stringify(value) ?? undefined;
    } catch {
      return undefined;
    }
  };

  let formatted = "Error: [unable to format fatal error]";

  try {
    if (error instanceof Error) {
      const rawName = (error as { name?: unknown }).name;
      const name = typeof rawName === "string" && rawName.trim() ? rawName : "Error";

      const rawMessage = (error as { message?: unknown }).message;
      const message =
        typeof rawMessage === "string"
          ? rawMessage
          : rawMessage == null
            ? ""
            : safeToString(rawMessage);

      formatted = `${name}: ${message}`;
    } else {
      const errorType = typeof error;
      const stringified =
        typeof error === "string" ? error : (safeJsonStringify(error) ?? safeToString(error));
      formatted = `${errorType}: ${stringified}`;
    }
  } catch {
    // Keep fallback.
  }

  const redactUriUserinfo = (text: string): string => {
    if (!text.includes("://") || !text.includes("@")) return text;

    let cursor = 0;
    let redacted = "";
    let changed = false;

    while (cursor < text.length) {
      const schemeSepIndex = text.indexOf("://", cursor);
      if (schemeSepIndex === -1) break;

      const authorityStart = schemeSepIndex + 3;
      redacted += text.slice(cursor, authorityStart);

      let scanIndex = authorityStart;
      while (scanIndex < text.length) {
        const ch = text.charCodeAt(scanIndex);

        if (ch === 64) {
          if (scanIndex !== authorityStart) {
            redacted += "***@";
            changed = true;
          } else {
            redacted += "@";
          }
          cursor = scanIndex + 1;
          break;
        }

        if (
          ch === 47 ||
          ch === 63 ||
          ch === 35 ||
          ch === 32 ||
          ch === 9 ||
          ch === 10 ||
          ch === 13 ||
          ch === 12
        ) {
          redacted += text.slice(authorityStart, scanIndex);
          cursor = scanIndex;
          break;
        }

        scanIndex += 1;
      }

      if (scanIndex >= text.length) {
        redacted += text.slice(authorityStart);
        cursor = text.length;
        break;
      }
    }

    if (!changed) return text;
    return redacted + text.slice(cursor);
  };

  formatted = redactUriUserinfo(formatted);

  return formatted.length > 500 ? formatted.slice(0, 500) : formatted;
}
