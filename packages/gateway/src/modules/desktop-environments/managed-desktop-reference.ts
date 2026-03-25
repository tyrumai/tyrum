import {
  RoutedToolExecutionMetadata,
  type Approval,
  type ManagedDesktopReference,
  type NodePairingRequest,
} from "@tyrum/contracts";
import type { DesktopEnvironmentDal } from "./dal.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readSelectedNodeIdFromApprovalContext(context: unknown): string | undefined {
  const record = asRecord(context);
  if (!record) {
    return undefined;
  }

  const parsedRouting = RoutedToolExecutionMetadata.safeParse(record["routing"]);
  if (parsedRouting.success) {
    return parsedRouting.data.selected_node_id;
  }

  const args = asRecord(record["args"]);
  const fallbackNodeId = typeof args?.["node_id"] === "string" ? args["node_id"].trim() : "";
  return fallbackNodeId || undefined;
}

export async function listManagedDesktopReferencesByNodeIds(input: {
  environmentDal: DesktopEnvironmentDal;
  tenantId: string;
  nodeIds: readonly string[];
}): Promise<Map<string, ManagedDesktopReference>> {
  const environments = await input.environmentDal.listByNodeIds({
    tenantId: input.tenantId,
    nodeIds: input.nodeIds,
  });
  const references = new Map<string, ManagedDesktopReference>();
  for (const environment of environments) {
    if (!environment.node_id || references.has(environment.node_id)) {
      continue;
    }
    references.set(environment.node_id, {
      environment_id: environment.environment_id,
    });
  }
  return references;
}

export async function enrichApprovalsWithManagedDesktop(input: {
  environmentDal?: DesktopEnvironmentDal;
  tenantId: string;
  approvals: readonly Approval[];
}): Promise<Approval[]> {
  if (!input.environmentDal || input.approvals.length === 0) {
    return [...input.approvals];
  }

  const nodeIds = input.approvals
    .map((approval) => readSelectedNodeIdFromApprovalContext(approval.context))
    .filter((nodeId): nodeId is string => typeof nodeId === "string");
  const managedDesktopByNodeId = await listManagedDesktopReferencesByNodeIds({
    environmentDal: input.environmentDal,
    tenantId: input.tenantId,
    nodeIds,
  });
  return input.approvals.map((approval) => {
    const nodeId = readSelectedNodeIdFromApprovalContext(approval.context);
    if (!nodeId) {
      return approval;
    }
    const managedDesktop = managedDesktopByNodeId.get(nodeId);
    if (!managedDesktop) {
      return approval;
    }
    return {
      ...approval,
      managed_desktop: managedDesktop,
    };
  });
}

export async function enrichApprovalWithManagedDesktop(input: {
  environmentDal?: DesktopEnvironmentDal;
  tenantId: string;
  approval: Approval;
}): Promise<Approval> {
  const [approval] = await enrichApprovalsWithManagedDesktop({
    environmentDal: input.environmentDal,
    tenantId: input.tenantId,
    approvals: [input.approval],
  });
  return approval ?? input.approval;
}

export async function enrichPairingsWithManagedDesktop(input: {
  environmentDal?: DesktopEnvironmentDal;
  tenantId: string;
  pairings: readonly NodePairingRequest[];
}): Promise<NodePairingRequest[]> {
  if (!input.environmentDal || input.pairings.length === 0) {
    return [...input.pairings];
  }

  const managedDesktopByNodeId = await listManagedDesktopReferencesByNodeIds({
    environmentDal: input.environmentDal,
    tenantId: input.tenantId,
    nodeIds: input.pairings.map((pairing) => pairing.node.node_id),
  });
  return input.pairings.map((pairing) => {
    const managedDesktop = managedDesktopByNodeId.get(pairing.node.node_id);
    if (!managedDesktop) {
      return pairing;
    }
    return {
      ...pairing,
      node: {
        ...pairing.node,
        managed_desktop: managedDesktop,
      },
    };
  });
}

export async function enrichPairingWithManagedDesktop(input: {
  environmentDal?: DesktopEnvironmentDal;
  tenantId: string;
  pairing: NodePairingRequest;
}): Promise<NodePairingRequest> {
  const [pairing] = await enrichPairingsWithManagedDesktop({
    environmentDal: input.environmentDal,
    tenantId: input.tenantId,
    pairings: [input.pairing],
  });
  return pairing ?? input.pairing;
}
