import { toErrorMessage } from "./to-error-message.js";

export type OperatorCoreErrorKind = "ws" | "http" | "unknown";

export type OperatorCoreError = {
  kind: OperatorCoreErrorKind;
  operation: string;
  code: string | null;
  message: string;
};

export function toOperatorCoreError(
  kind: OperatorCoreErrorKind,
  operation: string,
  error: unknown,
): OperatorCoreError {
  const message = toErrorMessage(error);

  const wsMatch = message.match(/^(.+?) failed: ([^:]+): (.+)$/);
  if (wsMatch) {
    const op = wsMatch[1];
    const code = wsMatch[2];
    const msg = wsMatch[3];
    return {
      kind,
      operation: op && op.length > 0 ? op : operation,
      code: code ?? null,
      message: msg ?? message,
    };
  }

  if (message === `${operation} timed out`) {
    return { kind, operation, code: "timeout", message: "timed out" };
  }

  return { kind, operation, code: null, message };
}
