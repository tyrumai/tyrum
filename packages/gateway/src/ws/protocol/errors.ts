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

export class NodeDispatchDeniedError extends Error {
  constructor(
    public readonly capability: ClientCapability,
    public readonly policySnapshotId?: string,
  ) {
    const suffix = policySnapshotId ? ` (policy snapshot: ${policySnapshotId})` : "";
    super(`node dispatch denied by policy for capability: ${capability}${suffix}`);
    this.name = "NodeDispatchDeniedError";
  }
}
