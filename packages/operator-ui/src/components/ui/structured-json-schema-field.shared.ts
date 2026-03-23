import type * as React from "react";

type StructuredJsonSchemaBase = {
  description?: string;
  title?: string;
};

type StructuredJsonStringSchema = StructuredJsonSchemaBase & {
  enum?: readonly string[];
  type: "string";
};

type StructuredJsonBooleanSchema = StructuredJsonSchemaBase & {
  type: "boolean";
};

type StructuredJsonIntegerSchema = StructuredJsonSchemaBase & {
  maximum?: number;
  minimum?: number;
  type: "integer";
};

type StructuredJsonNumberSchema = StructuredJsonSchemaBase & {
  maximum?: number;
  minimum?: number;
  type: "number";
};

type StructuredJsonArraySchema = StructuredJsonSchemaBase & {
  items?: StructuredJsonSchema;
  maxItems?: number;
  minItems?: number;
  type: "array";
};

export type StructuredJsonObjectSchema = StructuredJsonSchemaBase & {
  additionalProperties?: boolean;
  properties: Record<string, StructuredJsonSchema>;
  propertyOrder?: readonly string[];
  required?: readonly string[];
  type: "object";
};

export type StructuredJsonSchema =
  | StructuredJsonArraySchema
  | StructuredJsonBooleanSchema
  | StructuredJsonIntegerSchema
  | StructuredJsonNumberSchema
  | StructuredJsonObjectSchema
  | StructuredJsonStringSchema;

export type StructuredJsonSchemaProperty = StructuredJsonSchema;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function orderedSchemaKeys(schema: StructuredJsonObjectSchema): string[] {
  const configured = schema.propertyOrder?.filter((key) =>
    Object.prototype.hasOwnProperty.call(schema.properties, key),
  );
  const remaining = Object.keys(schema.properties).filter((key) => !configured?.includes(key));
  return [...(configured ?? []), ...remaining];
}

export function firstError(errors: Record<string, string | null>): string | null {
  return (
    Object.values(errors).find((value) => typeof value === "string" && value.length > 0) ?? null
  );
}

export function normalizeValueForSchema(
  schema: StructuredJsonSchema,
  value: unknown,
): unknown | undefined {
  switch (schema.type) {
    case "string":
      return typeof value === "string" && value.trim().length > 0 ? value : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? value : undefined;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "array":
      return Array.isArray(value)
        ? value
            .map((item) => (schema.items ? normalizeValueForSchema(schema.items, item) : item))
            .filter((item) => item !== undefined)
        : undefined;
    case "object":
      return readSchemaObjectValue(schema as StructuredJsonObjectSchema, value);
  }
}

export function readSchemaObjectValue(
  schema: StructuredJsonObjectSchema,
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([key, entryValue]) => {
    const propertySchema = schema.properties[key];
    if (propertySchema) {
      const normalized = normalizeValueForSchema(propertySchema, entryValue);
      return normalized === undefined ? [] : [[key, normalized] as const];
    }
    if (schema.additionalProperties === false) {
      return [];
    }
    return [[key, entryValue] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function updateObjectValue(
  current: Record<string, unknown> | undefined,
  key: string,
  nextValue: unknown,
): Record<string, unknown> | undefined {
  const next = current ? { ...current } : {};
  if (nextValue === undefined) {
    delete next[key];
  } else {
    next[key] = nextValue;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function splitSchemaObjectValue(input: {
  schema: StructuredJsonObjectSchema;
  value: Record<string, unknown> | undefined;
}): {
  additionalValues: Record<string, unknown> | undefined;
  knownValues: Record<string, unknown> | undefined;
} {
  const knownEntries: Array<[string, unknown]> = [];
  const additionalEntries: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(input.value ?? {})) {
    if (Object.prototype.hasOwnProperty.call(input.schema.properties, key)) {
      knownEntries.push([key, value]);
      continue;
    }
    additionalEntries.push([key, value]);
  }

  return {
    knownValues: knownEntries.length > 0 ? Object.fromEntries(knownEntries) : undefined,
    additionalValues:
      additionalEntries.length > 0 ? Object.fromEntries(additionalEntries) : undefined,
  };
}

export function mergeKnownAndAdditionalValues(input: {
  additionalValues: Record<string, unknown> | undefined;
  knownValues: Record<string, unknown> | undefined;
}): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = {};
  if (input.knownValues) {
    Object.assign(next, input.knownValues);
  }
  if (input.additionalValues) {
    Object.assign(next, input.additionalValues);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function reorderItems(
  items: readonly unknown[],
  fromIndex: number,
  toIndex: number,
): unknown[] {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function helperTextForSchema(
  schema: StructuredJsonSchema,
  helperText?: React.ReactNode,
): React.ReactNode {
  return helperText ?? schema.description;
}

export function createDefaultSchemaValue(schema: StructuredJsonSchema | undefined): unknown {
  if (!schema) {
    return "";
  }
  switch (schema.type) {
    case "boolean":
      return false;
    case "integer":
    case "number":
      return 0;
    case "array":
      return [];
    case "object":
      return {};
    case "string":
      return "";
  }
}
