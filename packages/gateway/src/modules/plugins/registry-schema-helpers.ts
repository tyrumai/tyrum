import type { ErrorObject } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { isRecord } from "../../utils/parse-json-or-yaml.js";
import type { NormalizeSchemaOptions } from "./registry-types.js";

const JSON_SCHEMA_CHILD_KEYS = new Set([
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
  "additionalItems",
]);
const JSON_SCHEMA_ARRAY_KEYS = new Set(["prefixItems", "anyOf", "oneOf"]);
const JSON_SCHEMA_RECORD_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isJsonSchemaObject = (value: unknown): value is Record<string, unknown> => isRecord(value);
const hasSchemaProperties = (value: object) =>
  hasOwn(value, "properties") || hasOwn(value, "patternProperties");
const unescapeJsonPointerSegment = (value: string) =>
  value.replace(/~[01]/g, (match) => (match === "~1" ? "/" : "~"));

function looksLikeJsonSchemaObjectShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = value["type"];
  return (
    type === "object" ||
    (Array.isArray(type) && type.includes("object")) ||
    hasSchemaProperties(value)
  );
}

function resolveInternalJsonSchemaRef(root: unknown, ref: string): unknown | undefined {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const part of ref.slice(2).split("/").map(unescapeJsonPointerSegment)) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function looksLikeJsonSchemaObjectShapeOrRef(
  value: unknown,
  root: unknown,
  seenRefs = new Set<string>(),
): boolean {
  if (looksLikeJsonSchemaObjectShape(value)) return true;
  if (!isRecord(value)) return false;
  const ref = value["$ref"];
  if (typeof ref !== "string" || seenRefs.has(ref)) return false;
  seenRefs.add(ref);
  const resolved = resolveInternalJsonSchemaRef(root, ref);
  return resolved ? looksLikeJsonSchemaObjectShapeOrRef(resolved, root, seenRefs) : false;
}

export function collectAllOfInternalRefTargets(root: unknown): WeakSet<object> {
  const targets = new WeakSet<object>(),
    visited = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) return void node.forEach(visit);
    const record = node as Record<string, unknown>,
      allOf = record["allOf"],
      ref = record["$ref"];
    if (Array.isArray(allOf)) {
      for (const entry of allOf) {
        if (!isRecord(entry) || typeof entry["$ref"] !== "string") continue;
        const resolved = resolveInternalJsonSchemaRef(root, entry["$ref"]);
        if (resolved && typeof resolved === "object") targets.add(resolved as object);
      }
    }
    if (
      typeof ref === "string" &&
      !(Array.isArray(allOf) && allOf.length > 0) &&
      hasSchemaProperties(record) &&
      !hasOwn(record, "additionalProperties") &&
      !hasOwn(record, "unevaluatedProperties") &&
      looksLikeJsonSchemaObjectShapeOrRef(record, root)
    ) {
      const resolved = resolveInternalJsonSchemaRef(root, ref);
      if (resolved && typeof resolved === "object") targets.add(resolved as object);
    }
    Object.values(record).forEach(visit);
  };
  visit(root);
  return targets;
}

export function normalizeJsonSchemaAdditionalPropertiesDefaults(
  schema: unknown,
  seen = new WeakMap<object, unknown>(),
  opts?: NormalizeSchemaOptions,
): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const existing = seen.get(schema);
  if (existing) return existing;
  const childOpts = opts ? { ...opts, skipAdditionalPropertiesDefault: false } : undefined;
  if (Array.isArray(schema)) {
    const out = schema.map((item) =>
      normalizeJsonSchemaAdditionalPropertiesDefaults(item, seen, childOpts),
    );
    seen.set(schema, out);
    return out;
  }
  const record = schema as Record<string, unknown>,
    out = Object.create(null) as Record<string, unknown>;
  seen.set(schema, out);
  const allOf = record["allOf"],
    hasAllOf = Array.isArray(allOf) && allOf.length > 0,
    root = opts?.root;
  const skipAdditionalPropertiesDefault = Boolean(
    opts?.skipAdditionalPropertiesDefault || opts?.skipAdditionalPropertiesDefaultFor?.has(schema),
  );
  const additionalPropertiesExplicit = hasOwn(record, "additionalProperties"),
    unevaluatedPropertiesExplicit = hasOwn(record, "unevaluatedProperties");
  const isObjectSchema = looksLikeJsonSchemaObjectShape(record);
  const looksLikeAllOfObjectSchema =
    hasAllOf &&
    (isObjectSchema ||
      (root
        ? (allOf as unknown[]).some((entry) => looksLikeJsonSchemaObjectShapeOrRef(entry, root))
        : (allOf as unknown[]).some(looksLikeJsonSchemaObjectShape)));
  for (const [key, value] of Object.entries(record)) {
    if (key === "additionalProperties" || key === "unevaluatedProperties") {
      out[key] =
        typeof value === "boolean"
          ? value
          : normalizeJsonSchemaAdditionalPropertiesDefaults(value, seen, childOpts);
      continue;
    }
    if (JSON_SCHEMA_CHILD_KEYS.has(key)) {
      out[key] = normalizeJsonSchemaAdditionalPropertiesDefaults(value, seen, childOpts);
      continue;
    }
    if (JSON_SCHEMA_ARRAY_KEYS.has(key)) {
      out[key] = Array.isArray(value)
        ? value.map((entry) =>
            normalizeJsonSchemaAdditionalPropertiesDefaults(entry, seen, childOpts),
          )
        : value;
      continue;
    }
    if (key === "allOf") {
      out[key] = Array.isArray(value)
        ? value.map((entry) =>
            normalizeJsonSchemaAdditionalPropertiesDefaults(entry, seen, {
              ...opts,
              skipAdditionalPropertiesDefault: true,
            }),
          )
        : value;
      continue;
    }
    if (JSON_SCHEMA_RECORD_KEYS.has(key)) {
      out[key] = isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).map(([prop, schemaValue]) => [
              prop,
              normalizeJsonSchemaAdditionalPropertiesDefaults(schemaValue, seen, childOpts),
            ]),
          )
        : value;
      continue;
    }
    out[key] = value;
  }
  if (
    !skipAdditionalPropertiesDefault &&
    !additionalPropertiesExplicit &&
    !unevaluatedPropertiesExplicit
  ) {
    if (looksLikeAllOfObjectSchema) out["unevaluatedProperties"] = false;
    else if (isObjectSchema) out["additionalProperties"] = false;
  }
  const ref = record["$ref"];
  if (
    typeof ref === "string" &&
    !skipAdditionalPropertiesDefault &&
    !additionalPropertiesExplicit &&
    !unevaluatedPropertiesExplicit &&
    !hasAllOf &&
    root &&
    looksLikeJsonSchemaObjectShapeOrRef(record, root)
  ) {
    delete out["additionalProperties"];
    delete out["$ref"];
    out["allOf"] = [{ $ref: ref }];
    out["unevaluatedProperties"] = false;
  }
  return out;
}

export function validatePluginConfig(params: {
  schema: unknown;
  config: unknown;
}):
  | { ok: true; normalizedSchema: Record<string, unknown>; config: unknown }
  | { ok: false; error: string } {
  const normalizedSchema = normalizeJsonSchemaAdditionalPropertiesDefaults(
    params.schema,
    new WeakMap<object, unknown>(),
    {
      root: params.schema,
      skipAdditionalPropertiesDefaultFor: collectAllOfInternalRefTargets(params.schema),
    },
  );
  if (!isJsonSchemaObject(normalizedSchema))
    return { ok: false, error: "config_schema must be a JSON Schema object" };
  try {
    const validate = new Ajv2019({ allErrors: true, strict: false, unevaluated: true }).compile(
      normalizedSchema,
    );
    if (validate(params.config)) return { ok: true, normalizedSchema, config: params.config };
    const errors = ((validate.errors ?? []) as ErrorObject[])
      .map(
        (err) =>
          `${err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/"}: ${err.message ? String(err.message) : "invalid"}`,
      )
      .filter(Boolean);
    return {
      ok: false,
      error: errors.length > 0 ? errors.join("; ") : "config does not match schema",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
