import type { SecretProvider } from "./provider.js";
import type { SecretHandle as SecretHandleT } from "@tyrum/schemas";

/** Replace secret values in text with [REDACTED]. */
export async function redactSecrets(
  text: string,
  handles: SecretHandleT[],
  provider: SecretProvider,
): Promise<string> {
  let result = text;
  for (const handle of handles) {
    const value = await provider.resolve(handle);
    if (value && value.length > 0) {
      result = result.replaceAll(value, "[REDACTED]");
    }
  }
  return result;
}
