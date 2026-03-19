import {
  normalizeCapabilityDescriptors,
  type CapabilityDescriptor,
  type NodeCapabilityState,
  type WsEventEnvelope,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";

export interface NodeCapabilityReadinessPort {
  setReadyCapabilities(connectionId: string, capabilities: readonly CapabilityDescriptor[]): void;
  setCapabilityStates(connectionId: string, capabilityStates: readonly NodeCapabilityState[]): void;
}

export interface NodeCapabilityReadinessStorePort {
  setReadyCapabilities(input: {
    tenantId: string;
    connectionId: string;
    readyCapabilities: readonly CapabilityDescriptor[];
  }): Promise<void>;
  setCapabilityStates(input: {
    tenantId: string;
    connectionId: string;
    capabilityStates: readonly NodeCapabilityState[];
  }): Promise<void>;
}

export interface RecordNodeCapabilityReadyDeps {
  readiness: NodeCapabilityReadinessPort;
  readinessStore?: NodeCapabilityReadinessStorePort;
  emitEvent: (input: { tenantId: string; event: WsEventEnvelope }) => void;
  onPersistenceFailure?: (input: {
    kind: "ready_capabilities" | "capability_states";
    error: unknown;
  }) => void;
}

export interface RecordNodeCapabilityReadyInput {
  tenantId: string;
  connectionId: string;
  nodeId: string;
  advertisedCapabilities: readonly CapabilityDescriptor[];
  reportedCapabilities: readonly CapabilityDescriptor[];
  reportedCapabilityStates: readonly NodeCapabilityState[];
  occurredAt?: string;
}

export function recordNodeCapabilityReady(
  deps: RecordNodeCapabilityReadyDeps,
  input: RecordNodeCapabilityReadyInput,
): {
  readyCapabilities: CapabilityDescriptor[];
  capabilityStates: NodeCapabilityState[];
} {
  const advertisedIds = new Set(input.advertisedCapabilities.map((capability) => capability.id));
  const readyCapabilities = normalizeCapabilityDescriptors(input.reportedCapabilities).filter(
    (capability) => advertisedIds.has(capability.id),
  );
  const capabilityStates = input.reportedCapabilityStates.filter((state) =>
    advertisedIds.has(state.capability.id),
  );

  deps.readiness.setReadyCapabilities(input.connectionId, readyCapabilities);
  deps.readiness.setCapabilityStates(input.connectionId, capabilityStates);

  if (deps.readinessStore) {
    void deps.readinessStore
      .setReadyCapabilities({
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        readyCapabilities: [...readyCapabilities].toSorted((a, b) => a.id.localeCompare(b.id)),
      })
      .catch((error) => {
        deps.onPersistenceFailure?.({ kind: "ready_capabilities", error });
      });
    void deps.readinessStore
      .setCapabilityStates({
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        capabilityStates,
      })
      .catch((error) => {
        deps.onPersistenceFailure?.({ kind: "capability_states", error });
      });
  }

  deps.emitEvent({
    tenantId: input.tenantId,
    event: {
      event_id: randomUUID(),
      type: "capability.ready",
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      scope: {
        kind: "node",
        node_id: input.nodeId,
      },
      payload: {
        node_id: input.nodeId,
        capabilities: readyCapabilities,
        capability_states: capabilityStates,
      },
    },
  });

  return { readyCapabilities, capabilityStates };
}
