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

export class NoCapableNodeError extends Error {
  constructor(public readonly capability: ClientCapability) {
    super(`no connected node with capability: ${capability}`);
    this.name = "NoCapableNodeError";
  }
}

export class NodeNotPairedError extends Error {
  constructor(public readonly capability: ClientCapability) {
    super(`no paired node with capability: ${capability}`);
    this.name = "NodeNotPairedError";
  }
}
