import type { NodeDispatchService, NodeInventoryService } from "@tyrum/runtime-node-control";
import { Hono } from "hono";
import {
  NodeActionDispatchRequest,
  NodeActionDispatchResponse,
  NodeCapabilityInspectionResponse,
  NodeInventoryResponse,
  isLegacyUmbrellaCapabilityDescriptorId,
} from "@tyrum/contracts";
import { requireTenantId } from "../app/modules/auth/claims.js";
import { NodeCapabilityInspectionService } from "../app/modules/node/capability-inspection-service.js";
import { executeHttpNodeDispatch } from "../app/modules/agent/tool-executor-node-dispatch.js";
import type { ArtifactStore } from "../app/modules/artifact/store.js";
import type { DesktopEnvironmentDal } from "../app/modules/desktop-environments/dal.js";
import { listManagedDesktopReferencesByNodeIds } from "../app/modules/desktop-environments/managed-desktop-reference.js";

export function createNodesRoute(deps: {
  inventoryService: NodeInventoryService;
  inspectionService?: NodeCapabilityInspectionService;
  nodeDispatchService?: NodeDispatchService;
  artifactStore?: ArtifactStore;
  desktopEnvironmentDal?: DesktopEnvironmentDal;
}): Hono {
  const app = new Hono();
  const { artifactStore, inspectionService, inventoryService, nodeDispatchService } = deps;

  app.get("/nodes", async (c) => {
    const tenantId = requireTenantId(c);
    const capability = c.req.query("capability")?.trim() || undefined;
    if (capability && isLegacyUmbrellaCapabilityDescriptorId(capability)) {
      return c.json(
        {
          error: "invalid_request",
          message: `legacy umbrella capability '${capability}' is not supported; use exact split descriptors`,
        },
        400,
      );
    }
    const dispatchableOnlyRaw = c.req.query("dispatchable_only")?.trim().toLowerCase();
    const dispatchableOnly =
      dispatchableOnlyRaw === undefined
        ? false
        : !["0", "false", "no"].includes(dispatchableOnlyRaw);
    const key = c.req.query("key")?.trim() || undefined;
    const lane = c.req.query("lane")?.trim() || undefined;

    const result = await inventoryService.list({
      tenantId,
      capability,
      dispatchableOnly,
      key,
      lane,
    });
    const managedDesktopByNodeId = deps.desktopEnvironmentDal
      ? await listManagedDesktopReferencesByNodeIds({
          environmentDal: deps.desktopEnvironmentDal,
          tenantId,
          nodeIds: result.nodes.map((node) => node.node_id),
        })
      : new Map();

    return c.json(
      NodeInventoryResponse.parse({
        status: "ok",
        generated_at: new Date().toISOString(),
        ...result,
        nodes: result.nodes.map((node) => {
          const managedDesktop = managedDesktopByNodeId.get(node.node_id);
          if (!managedDesktop) {
            return node;
          }
          return Object.assign({}, node, { managed_desktop: managedDesktop });
        }),
      }),
    );
  });

  if (inspectionService) {
    app.get("/nodes/:nodeId/capabilities/:capabilityId", async (c) => {
      const tenantId = requireTenantId(c);
      const includeDisabledRaw = c.req.query("include_disabled")?.trim().toLowerCase();
      const includeDisabled =
        includeDisabledRaw === undefined
          ? false
          : ["1", "true", "yes"].includes(includeDisabledRaw);
      const capabilityId = c.req.param("capabilityId");
      if (isLegacyUmbrellaCapabilityDescriptorId(capabilityId)) {
        return c.json(
          {
            error: "invalid_request",
            message: `legacy umbrella capability '${capabilityId}' is not supported; use exact split descriptors`,
          },
          400,
        );
      }

      const result = await inspectionService.inspect({
        tenantId,
        nodeId: c.req.param("nodeId"),
        capabilityId,
        includeDisabled,
      });

      return c.json(NodeCapabilityInspectionResponse.parse(result));
    });
  }

  if (inspectionService && nodeDispatchService) {
    app.post(
      "/nodes/:nodeId/capabilities/:capabilityId/actions/:actionName/dispatch",
      async (c) => {
        const tenantId = requireTenantId(c);
        const capabilityId = c.req.param("capabilityId");
        if (isLegacyUmbrellaCapabilityDescriptorId(capabilityId)) {
          return c.json(
            {
              error: "invalid_request",
              message: `legacy umbrella capability '${capabilityId}' is not supported; use exact split descriptors`,
            },
            400,
          );
        }
        const body = await c.req.json();
        const parsed = NodeActionDispatchRequest.parse({
          ...(body && typeof body === "object" ? body : {}),
          node_id: c.req.param("nodeId"),
          capability: capabilityId,
          action_name: c.req.param("actionName"),
        });

        const result = await executeHttpNodeDispatch(
          {
            tenantId,
            nodeDispatchService,
            inspectionService,
            artifactStore,
          },
          parsed,
        );

        return c.json(NodeActionDispatchResponse.parse(result));
      },
    );
  }

  return app;
}
