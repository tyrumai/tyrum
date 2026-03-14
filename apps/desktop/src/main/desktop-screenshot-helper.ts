import { NutJsDesktopBackend } from "@tyrum/desktop-node";

type DesktopDisplayTargetValue = "primary" | "all" | { id: string };

type HelperSuccess = {
  ok: true;
  width: number;
  height: number;
  bytesBase64: string;
};

type HelperFailure = {
  ok: false;
  error: string;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message;
    if (error.name) return error.name;
    return "Error";
  }
  return typeof error === "string" ? error : String(error);
}

function writeResponse(response: HelperSuccess | HelperFailure): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function isDisplayTarget(value: unknown): value is DesktopDisplayTargetValue {
  if (value === "primary" || value === "all") {
    return true;
  }
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function parseDisplayArg(
  argv: string[],
): { success: true; display: DesktopDisplayTargetValue } | HelperFailure {
  const rawPayload = argv[2];
  if (typeof rawPayload !== "string" || rawPayload.trim().length === 0) {
    return { ok: false, error: "Missing screen capture helper payload." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload) as unknown;
  } catch (error) {
    return { ok: false, error: `Invalid screen capture helper payload: ${toErrorMessage(error)}` };
  }

  const display =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { display?: unknown }).display
      : undefined;
  if (!isDisplayTarget(display)) {
    return {
      ok: false,
      error: "Invalid screen capture helper display.",
    };
  }

  return { success: true, display };
}

async function main(): Promise<void> {
  const parsed = parseDisplayArg(process.argv);
  if (!("success" in parsed)) {
    writeResponse(parsed);
    return;
  }

  try {
    const backend = new NutJsDesktopBackend();
    const capture = await backend.captureScreen(parsed.display);
    writeResponse({
      ok: true,
      width: capture.width,
      height: capture.height,
      bytesBase64: capture.buffer.toString("base64"),
    });
  } catch (error) {
    writeResponse({ ok: false, error: toErrorMessage(error) });
  }
}

void main();
