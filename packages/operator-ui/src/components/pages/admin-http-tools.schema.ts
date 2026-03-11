import { isRecord } from "../../utils/is-record.js";

export interface StructuredToolSchemaRow {
  field: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface StructuredToolSchemaSection {
  id: string;
  label: string;
  rows: StructuredToolSchemaRow[];
  summary?: string;
}

export interface StructuredToolSchema {
  sections: StructuredToolSchemaSection[];
  summary?: string;
}

export function buildStructuredToolSchema(
  schema: Record<string, unknown> | undefined,
): StructuredToolSchema | null {
  if (!schema) return null;

  const sections = buildSections(schema);
  if (sections.length > 0) return { sections };

  return {
    sections: [],
    summary: buildLooseSummary(schema),
  };
}

function buildSections(schema: Record<string, unknown>): StructuredToolSchemaSection[] {
  const variants = readVariants(schema);
  if (variants.length > 0) {
    return variants.map((variant, index) => buildVariantSection(variant, index));
  }

  const rows = collectRows(schema, "");
  if (rows.length === 0) {
    return [];
  }

  return [
    {
      id: "fields",
      label: "Fields",
      rows,
      summary: buildSectionSummary(schema),
    },
  ];
}

function buildVariantSection(
  schema: Record<string, unknown>,
  index: number,
): StructuredToolSchemaSection {
  const rows = collectRows(schema, "");
  return {
    id: `variant-${String(index + 1)}`,
    label: detectVariantLabel(schema, index),
    rows,
    summary: rows.length > 0 ? buildSectionSummary(schema) : buildLooseSummary(schema),
  };
}

function collectRows(schema: Record<string, unknown>, prefix: string): StructuredToolSchemaRow[] {
  const properties = readProperties(schema);
  if (!properties) return [];

  const requiredFields = readRequired(schema);
  const rows: StructuredToolSchemaRow[] = [];

  for (const [fieldName, rawValue] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${fieldName}` : fieldName;
    const propertySchema = isRecord(rawValue) ? rawValue : {};

    rows.push({
      field: path,
      type: describeSchemaType(propertySchema),
      required: requiredFields.has(fieldName),
      description: readDescription(propertySchema),
    });

    const nestedProperties = collectRows(propertySchema, path);
    if (nestedProperties.length > 0) {
      rows.push(...nestedProperties);
      continue;
    }

    const itemSchema = readArrayItemSchema(propertySchema);
    if (!itemSchema) continue;

    rows.push(...collectRows(itemSchema, `${path}[]`));
  }

  return rows;
}

function readProperties(schema: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(schema.properties) ? schema.properties : null;
}

function readVariants(schema: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(schema.oneOf)) return [];
  return schema.oneOf.filter(isRecord);
}

function readRequired(schema: Record<string, unknown>): Set<string> {
  if (!Array.isArray(schema.required)) return new Set();
  return new Set(schema.required.filter((value): value is string => typeof value === "string"));
}

function readArrayItemSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(schema.items) ? schema.items : null;
}

function readDescription(schema: Record<string, unknown>): string | null {
  return typeof schema.description === "string" && schema.description.trim().length > 0
    ? schema.description
    : null;
}

function detectVariantLabel(schema: Record<string, unknown>, index: number): string {
  const properties = readProperties(schema);
  const kindSchema = properties?.["kind"];
  if (isRecord(kindSchema) && Array.isArray(kindSchema.enum) && kindSchema.enum.length === 1) {
    const onlyValue = kindSchema.enum[0];
    if (typeof onlyValue === "string" && onlyValue.trim().length > 0) {
      return onlyValue;
    }
  }

  return `Variant ${String(index + 1)}`;
}

function describeSchemaType(schema: Record<string, unknown>): string {
  const enumValues = readEnumValues(schema);
  const type = readType(schema);

  if (type === "array") {
    const itemSchema = readArrayItemSchema(schema);
    const itemType = itemSchema ? describeSchemaType(itemSchema) : "any";
    return `array<${itemType}>`;
  }

  if (enumValues.length > 0) {
    return `${type ?? inferEnumType(enumValues)} (${enumValues.join(", ")})`;
  }

  if (type) return type;
  if (readVariants(schema).length > 0) return "variant";
  return "any";
}

function readType(schema: Record<string, unknown>): string | null {
  if (typeof schema.type === "string" && schema.type.trim().length > 0) {
    return schema.type;
  }
  return null;
}

function readEnumValues(schema: Record<string, unknown>): string[] {
  if (!Array.isArray(schema.enum)) return [];
  return schema.enum.map((value) => String(value));
}

function inferEnumType(values: readonly string[]): string {
  return values.every((value) => value === "true" || value === "false") ? "boolean" : "enum";
}

function buildSectionSummary(schema: Record<string, unknown>): string | undefined {
  if (schema.additionalProperties === false) return "Additional fields not allowed.";
  if (schema.additionalProperties === true) return "Additional fields allowed.";
  return undefined;
}

function buildLooseSummary(schema: Record<string, unknown>): string {
  if (readVariants(schema).length > 0) {
    return "Accepts one of multiple structured input variants.";
  }

  const type = readType(schema);
  if (type === "array") {
    const itemSchema = readArrayItemSchema(schema);
    const itemType = itemSchema ? describeSchemaType(itemSchema) : "any";
    return `Accepts an array of ${itemType}.`;
  }

  if (type === "object") {
    return "Accepts arbitrary structured object input.";
  }

  return "Accepts arbitrary structured input.";
}
