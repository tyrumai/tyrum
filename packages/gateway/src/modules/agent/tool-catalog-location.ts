import type { ToolDescriptor } from "./tools.js";
import {
  LOCATION_PLACE_CREATE_PROMPT_METADATA,
  LOCATION_PLACE_UPDATE_PROMPT_METADATA,
} from "./tool-catalog-prompt-metadata.js";

const LOCATION_AGENT_SCOPE_PROPERTY = {
  type: "string",
  description:
    "Optional agent key. Omit to use the current agent scope when the tool runs in an agent turn.",
} as const;

const LOCATION_PLACE_FAMILY = "tool.location.place";

export const LOCATION_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "tool.location.place.list",
    description: "List saved places for the current or specified agent.",
    effect: "read_only",
    keywords: ["location", "place", "places", "saved", "list"],
    source: "builtin",
    family: LOCATION_PLACE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        agent_key: LOCATION_AGENT_SCOPE_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    id: "tool.location.place.create",
    description: "Create a saved place for the current or specified agent.",
    effect: "state_changing",
    keywords: ["location", "place", "places", "saved", "create"],
    ...LOCATION_PLACE_CREATE_PROMPT_METADATA,
    source: "builtin",
    family: LOCATION_PLACE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        agent_key: LOCATION_AGENT_SCOPE_PROPERTY,
        name: { type: "string", description: "Human-readable place name." },
        latitude: { type: "number", description: "Latitude in decimal degrees." },
        longitude: { type: "number", description: "Longitude in decimal degrees." },
        radius_m: {
          type: "number",
          description: "Optional positive integer radius in meters (default: 100).",
        },
        tags: {
          type: "array",
          description: "Optional place tags.",
          items: { type: "string" },
        },
        source: {
          type: "string",
          enum: ["manual", "poi_provider"],
          description: "Saved-place source.",
        },
        provider_place_id: {
          type: "string",
          description: "Optional provider-specific place identifier.",
        },
        metadata: {
          type: "object",
          description: "Optional metadata object.",
          additionalProperties: true,
        },
      },
      required: ["name", "latitude", "longitude"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.location.place.update",
    description: "Update an existing saved place.",
    effect: "state_changing",
    keywords: ["location", "place", "places", "saved", "update"],
    ...LOCATION_PLACE_UPDATE_PROMPT_METADATA,
    source: "builtin",
    family: LOCATION_PLACE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        agent_key: LOCATION_AGENT_SCOPE_PROPERTY,
        place_id: { type: "string", description: "Saved place id to update." },
        name: { type: "string", description: "Updated place name." },
        latitude: { type: "number", description: "Updated latitude in decimal degrees." },
        longitude: { type: "number", description: "Updated longitude in decimal degrees." },
        radius_m: { type: "number", description: "Updated positive integer radius in meters." },
        tags: {
          type: "array",
          description: "Updated place tags.",
          items: { type: "string" },
        },
        source: {
          type: "string",
          enum: ["manual", "poi_provider"],
          description: "Updated saved-place source.",
        },
        provider_place_id: {
          type: ["string", "null"],
          description: "Updated provider-specific place identifier, or null to clear it.",
        },
        metadata: {
          type: "object",
          description: "Updated metadata object.",
          additionalProperties: true,
        },
      },
      required: ["place_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.location.place.delete",
    description: "Delete a saved place.",
    effect: "state_changing",
    keywords: ["location", "place", "places", "saved", "delete"],
    source: "builtin",
    family: LOCATION_PLACE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        agent_key: LOCATION_AGENT_SCOPE_PROPERTY,
        place_id: { type: "string", description: "Saved place id to delete." },
      },
      required: ["place_id"],
      additionalProperties: false,
    },
  },
];
