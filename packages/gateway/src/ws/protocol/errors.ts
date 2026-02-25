import type { ClientCapability } from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class NoCapableClientError extends Error {
  constructor(public readonly capability: ClientCapability) {
    super(`no connected client with capability: ${capability}`);
    this.name = "NoCapableClientError";
  }
}
