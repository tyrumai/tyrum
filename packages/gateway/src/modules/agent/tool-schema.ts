import type { ToolDescriptor } from "./tools.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const TOP_LEVEL_UNSUPPORTED_MODEL_KEYS = ["oneOf", "anyOf", "allOf", "enum", "not"] as const;

function hasObjectRootType(schema: Record<string, unknown>): boolean {
  const type = schema["type"];
  if (type === "object") return true;
  return Array.isArray(type) && type.includes("object");
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record };
}

function mergeRequired(
  baseRequired: unknown,
  nextRequired: unknown,
  mode: "preserve_base" | "union",
): string[] | undefined {
  const base = Array.isArray(baseRequired)
    ? baseRequired.filter((value): value is string => typeof value === "string")
    : [];
  if (mode === "preserve_base") {
    return base.length > 0 ? [...new Set(base)] : undefined;
  }

  const extra = Array.isArray(nextRequired)
    ? nextRequired.filter((value): value is string => typeof value === "string")
    : [];
  const merged = [...new Set([...base, ...extra])];
  return merged.length > 0 ? merged : undefined;
}

function mergeProperties(
  baseProperties: unknown,
  nextProperties: unknown,
): Record<string, unknown> | undefined {
  const base = isRecord(baseProperties) ? cloneRecord(baseProperties) : {};
  if (!isRecord(nextProperties)) {
    return Object.keys(base).length > 0 ? base : undefined;
  }

  for (const [key, value] of Object.entries(nextProperties)) {
    if (key in base) {
      continue;
    }
    if (value === true || value === false) {
      base[key] = value;
      continue;
    }
    if (isRecord(value)) {
      base[key] = cloneRecord(value);
    }
  }

  return Object.keys(base).length > 0 ? base : undefined;
}

function mergeAdditionalProperties(
  baseValue: unknown,
  nextValue: unknown,
): boolean | Record<string, unknown> | undefined {
  if (baseValue === false || nextValue === false) {
    return false;
  }
  if (isRecord(baseValue)) return cloneRecord(baseValue);
  if (isRecord(nextValue)) return cloneRecord(nextValue);
  if (baseValue === true || nextValue === true) return true;
  return undefined;
}

function looksLikeObjectVariant(schema: unknown): schema is Record<string, unknown> {
  if (!isRecord(schema)) return false;
  return (
    hasObjectRootType(schema) ||
    isRecord(schema["properties"]) ||
    Array.isArray(schema["required"]) ||
    schema["additionalProperties"] !== undefined
  );
}

function normalizeTopLevelObjectCombinator(
  schema: Record<string, unknown>,
  key: "oneOf" | "anyOf" | "allOf",
): { ok: true; schema: Record<string, unknown> } | { ok: false; error: string } {
  const rawEntries = schema[key];
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    const cloned = cloneRecord(schema);
    delete cloned[key];
    return { ok: true, schema: cloned };
  }

  let normalized = cloneRecord(schema);
  for (const entry of rawEntries) {
    if (!looksLikeObjectVariant(entry)) {
      return {
        ok: false,
        error: `input schema top-level '${key}' entries must describe object variants`,
      };
    }

    normalized["properties"] = mergeProperties(normalized["properties"], entry["properties"]);
    normalized["required"] = mergeRequired(
      normalized["required"],
      entry["required"],
      key === "allOf" ? "union" : "preserve_base",
    );
    normalized["additionalProperties"] = mergeAdditionalProperties(
      normalized["additionalProperties"],
      entry["additionalProperties"],
    );
  }

  delete normalized[key];
  return { ok: true, schema: normalized };
}

export function validateModelToolInputSchema(
  schema: unknown,
): { ok: true; schema: Record<string, unknown> } | { ok: false; error: string } {
  if (!isRecord(schema)) {
    return { ok: false, error: "input schema must be a JSON Schema object" };
  }

  if (!hasObjectRootType(schema)) {
    return {
      ok: false,
      error: 'input schema must have a top-level JSON Schema object root (`type: "object"`)',
    };
  }

  let normalized = cloneRecord(schema);
  for (const key of TOP_LEVEL_UNSUPPORTED_MODEL_KEYS) {
    if (!(key in normalized)) continue;
    if (key === "oneOf" || key === "anyOf" || key === "allOf") {
      const result = normalizeTopLevelObjectCombinator(normalized, key);
      if (!result.ok) {
        return result;
      }
      normalized = result.schema;
      continue;
    }
    delete normalized[key];
  }

  return { ok: true, schema: normalized };
}

export function validateToolDescriptorInputSchema(
  descriptor: Pick<ToolDescriptor, "id" | "inputSchema">,
): { ok: true; schema: Record<string, unknown> } | { ok: false; error: string } {
  const schema = descriptor.inputSchema ?? { type: "object", additionalProperties: true };
  const validated = validateModelToolInputSchema(schema);
  if (validated.ok) return validated;
  return { ok: false, error: `${descriptor.id}: ${validated.error.trim()}` };
}
