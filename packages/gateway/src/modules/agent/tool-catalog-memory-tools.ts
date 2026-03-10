import type { ToolDescriptor } from "./tools.js";

export const MEMORY_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    id: "memory.search",
    description:
      "Search this agent's durable memory using hybrid retrieval. Supports facts, notes, procedures, and episodes.",
    risk: "low",
    requires_confirmation: false,
    keywords: ["memory", "search", "remember", "recall", "semantic", "knowledge"],
    source: "builtin",
    family: "memory",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for durable memory recall." },
        kinds: {
          type: "array",
          description: "Optional memory kind filter.",
          items: {
            type: "string",
            enum: ["fact", "note", "procedure", "episode"],
          },
        },
        tags: {
          type: "array",
          description: "Optional tag filters.",
          items: { type: "string" },
        },
        limit: {
          type: "number",
          description: "Optional result limit. Defaults to 5 and caps at 10.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    id: "memory.add",
    description:
      "Write durable memory for this agent. Tyrum supports facts, notes, procedures, and episodes; this tool creates facts, notes, or procedures.",
    risk: "medium",
    requires_confirmation: false,
    keywords: ["memory", "remember", "store", "save", "fact", "procedure"],
    source: "builtin",
    family: "memory",
    inputSchema: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fact"] },
            key: { type: "string", description: "Stable fact key." },
            value: { description: "Structured fact value." },
            confidence: {
              type: "number",
              description: "Optional confidence score between 0 and 1. Defaults to 1.",
            },
            observed_at: {
              type: "string",
              description: "Optional ISO timestamp. Defaults to now.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            sensitivity: { type: "string", enum: ["public", "private"] },
          },
          required: ["kind", "key", "value"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["note"] },
            title: { type: "string" },
            body_md: { type: "string", description: "Durable note body." },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            sensitivity: { type: "string", enum: ["public", "private"] },
          },
          required: ["kind", "body_md"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["procedure"] },
            title: { type: "string" },
            body_md: { type: "string", description: "Procedure or strategy body." },
            confidence: {
              type: "number",
              description: "Optional confidence score between 0 and 1.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            sensitivity: { type: "string", enum: ["public", "private"] },
          },
          required: ["kind", "body_md"],
          additionalProperties: false,
        },
      ],
    },
  },
];
