import {
  LocationPlaceCreateRequest,
  LocationPlacePatchRequest,
  type LocationPlacePatchRequest as LocationPlacePatchRequestT,
} from "@tyrum/contracts";
import { requireTenantIdValue, type IdentityScopeDal } from "../identity/scope.js";
import type { LocationService } from "../location/service.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";

type LocationExecutorContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  identityScopeDal?: IdentityScopeDal;
  locationService?: LocationService;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getLocationService(context: LocationExecutorContext): LocationService {
  if (!context.locationService) {
    throw new Error("location tools are not configured");
  }
  return context.locationService;
}

function requireWorkspaceLeaseTenantId(context: LocationExecutorContext): string {
  return requireTenantIdValue(context.workspaceLease?.tenantId);
}

function normalizeAgentKeyArg(parsed: Record<string, unknown> | null): string | undefined {
  const value = parsed?.["agent_key"];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveLocationAgentKey(
  context: LocationExecutorContext,
  parsed: Record<string, unknown> | null,
): Promise<string> {
  const explicit = normalizeAgentKeyArg(parsed);
  if (explicit) {
    return explicit;
  }

  const tenantId = requireWorkspaceLeaseTenantId(context);
  const agentId = context.workspaceLease?.agentId?.trim();
  if (!agentId) {
    throw new Error("agent_key is required when current agent scope is unavailable");
  }
  if (!context.identityScopeDal) {
    throw new Error("location tools are not configured");
  }

  const resolved = await context.identityScopeDal.resolveAgentKey(tenantId, agentId);
  if (!resolved) {
    throw new Error("current agent scope could not be resolved");
  }
  return resolved;
}

function hasDefinedPlacePatchField(patch: LocationPlacePatchRequestT): boolean {
  return Object.values(patch).some((value) => value !== undefined);
}

async function executeLocationPlaceList(
  context: LocationExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getLocationService(context);
  const parsed = asRecord(args);
  const tenantId = requireWorkspaceLeaseTenantId(context);
  const agentKey = await resolveLocationAgentKey(context, parsed);
  const places = await service.listPlaces({ tenantId, agentKey });
  return { tool_call_id: toolCallId, output: JSON.stringify({ places }) };
}

async function executeLocationPlaceCreate(
  context: LocationExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getLocationService(context);
  const parsed = LocationPlaceCreateRequest.safeParse(args);
  if (!parsed.success) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: parsed.error.message,
    };
  }

  const tenantId = requireWorkspaceLeaseTenantId(context);
  const agentKey = await resolveLocationAgentKey(context, asRecord(args));
  const place = await service.createPlace({
    tenantId,
    agentKey,
    body: parsed.data,
  });
  return { tool_call_id: toolCallId, output: JSON.stringify({ place }) };
}

async function executeLocationPlaceUpdate(
  context: LocationExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getLocationService(context);
  const parsedArgs = asRecord(args);
  const placeId = typeof parsedArgs?.["place_id"] === "string" ? parsedArgs["place_id"].trim() : "";
  if (!placeId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: place_id",
    };
  }

  const { place_id: _placeId, agent_key: _agentKey, ...patchInput } = parsedArgs ?? {};
  const parsedPatch = LocationPlacePatchRequest.safeParse(patchInput);
  if (!parsedPatch.success) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: parsedPatch.error.message,
    };
  }
  if (!hasDefinedPlacePatchField(parsedPatch.data)) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "location place update request must include at least one field",
    };
  }

  const tenantId = requireWorkspaceLeaseTenantId(context);
  const agentKey = await resolveLocationAgentKey(context, parsedArgs);
  const place = await service.updatePlace({
    tenantId,
    agentKey,
    placeId,
    patch: parsedPatch.data,
  });
  return { tool_call_id: toolCallId, output: JSON.stringify({ place }) };
}

async function executeLocationPlaceDelete(
  context: LocationExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getLocationService(context);
  const parsed = asRecord(args);
  const placeId = typeof parsed?.["place_id"] === "string" ? parsed["place_id"].trim() : "";
  if (!placeId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: place_id",
    };
  }

  const tenantId = requireWorkspaceLeaseTenantId(context);
  const agentKey = await resolveLocationAgentKey(context, parsed);
  const deleted = await service.deletePlace({ tenantId, agentKey, placeId });
  if (!deleted) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "place not found",
    };
  }

  return {
    tool_call_id: toolCallId,
    output: JSON.stringify({ place_id: placeId, deleted: true }),
  };
}

export async function executeLocationPlaceTool(
  context: LocationExecutorContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult | null> {
  switch (toolId) {
    case "tool.location.place.list":
      return await executeLocationPlaceList(context, toolCallId, args);
    case "tool.location.place.create":
      return await executeLocationPlaceCreate(context, toolCallId, args);
    case "tool.location.place.update":
      return await executeLocationPlaceUpdate(context, toolCallId, args);
    case "tool.location.place.delete":
      return await executeLocationPlaceDelete(context, toolCallId, args);
    default:
      return null;
  }
}
