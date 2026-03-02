export { type ApiActionState, useApiAction } from "../../hooks/use-api-action.js";

export function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
