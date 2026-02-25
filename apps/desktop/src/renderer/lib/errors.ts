const IPC_INVOKE_PREFIX = /^Error invoking remote method '[^']+':\s*/;
const GENERIC_ERROR_PREFIX = /^Error:\s*/;

function normalizeErrorMessage(message: string): string {
  const stripped = message.replace(IPC_INVOKE_PREFIX, "").replace(GENERIC_ERROR_PREFIX, "").trim();
  return stripped.length > 0 ? stripped : "Unknown error.";
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeErrorMessage(error.message);
  }
  if (typeof error === "string") {
    return normalizeErrorMessage(error);
  }
  return "Unknown error.";
}
