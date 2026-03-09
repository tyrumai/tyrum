import type { CapabilityKind } from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class NoCapableClientError extends Error {
  constructor(public readonly capability: CapabilityKind) {
    super(`no connected client with capability: ${capability}`);
    this.name = "NoCapableClientError";
  }
}

export class NoCapableNodeError extends Error {
  constructor(public readonly capability: CapabilityKind) {
    super(`no connected node with capability: ${capability}`);
    this.name = "NoCapableNodeError";
  }
}

export class UnknownNodeError extends Error {
  constructor(public readonly nodeId: string) {
    super(`unknown node: ${nodeId}`);
    this.name = "UnknownNodeError";
  }
}

export class NodeNotConnectedError extends Error {
  constructor(public readonly nodeId: string) {
    super(`node is not connected: ${nodeId}`);
    this.name = "NodeNotConnectedError";
  }
}

export class NodeNotCapableError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly capability: CapabilityKind,
  ) {
    super(`node '${nodeId}' does not support capability: ${capability}`);
    this.name = "NodeNotCapableError";
  }
}

export class NodeNotReadyError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly capability: CapabilityKind,
  ) {
    super(`node '${nodeId}' is not ready for capability: ${capability}`);
    this.name = "NodeNotReadyError";
  }
}

export class NodeNotPairedError extends Error {
  constructor(public readonly capability: CapabilityKind) {
    super(`no paired node with capability: ${capability}`);
    this.name = "NodeNotPairedError";
  }
}

export class NodeDispatchDeniedError extends Error {
  constructor(
    public readonly capability: CapabilityKind,
    public readonly policySnapshotId?: string,
  ) {
    const suffix = policySnapshotId ? ` (policy snapshot: ${policySnapshotId})` : "";
    super(`node dispatch denied by policy for capability: ${capability}${suffix}`);
    this.name = "NodeDispatchDeniedError";
  }
}
