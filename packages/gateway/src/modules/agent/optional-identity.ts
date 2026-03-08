import type { IdentityPack as IdentityPackT } from "@tyrum/schemas";
import { loadIdentity } from "./workspace.js";

export async function loadOptionalIdentity(home: string): Promise<IdentityPackT | undefined> {
  try {
    return await loadIdentity(home);
  } catch {
    // Intentional: callers use this helper when identity metadata is optional.
    return undefined;
  }
}
