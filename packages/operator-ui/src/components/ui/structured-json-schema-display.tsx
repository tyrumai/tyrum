import * as React from "react";
import { cn } from "../../lib/cn.js";
import { isRecord } from "../../utils/is-record.js";
import { StructuredJsonDisplay } from "./structured-json-display.js";

export interface StructuredJsonSchemaDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  schema: Record<string, unknown>;
  value: unknown;
}

type DisplayObjectSchema = {
  additionalProperties: boolean;
  properties: Record<string, Record<string, unknown>>;
  propertyOrder: string[];
};

function readObjectSchema(schema: Record<string, unknown>): DisplayObjectSchema | null {
  const properties = isRecord(schema.properties)
    ? Object.entries(schema.properties).reduce<Record<string, Record<string, unknown>>>(
        (accumulator, [key, value]) => {
          if (isRecord(value)) {
            accumulator[key] = value;
          }
          return accumulator;
        },
        {},
      )
    : null;
  if (!properties) {
    return null;
  }

  const propertyOrder = Array.isArray(schema.propertyOrder)
    ? schema.propertyOrder.filter(
        (entry): entry is string =>
          typeof entry === "string" && Object.prototype.hasOwnProperty.call(properties, entry),
      )
    : [];
  const orderedKeys = [
    ...propertyOrder,
    ...Object.keys(properties).filter((key) => !propertyOrder.includes(key)),
  ];

  return {
    additionalProperties: schema.additionalProperties !== false,
    properties,
    propertyOrder: orderedKeys,
  };
}

function readVariantSchemas(schema: Record<string, unknown>): DisplayObjectSchema[] {
  if (!Array.isArray(schema.oneOf)) {
    return [];
  }
  return schema.oneOf
    .filter(isRecord)
    .map(readObjectSchema)
    .filter((value): value is DisplayObjectSchema => value !== null);
}

function detectVariantScore(schema: DisplayObjectSchema, value: Record<string, unknown>): number {
  let score = 0;
  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    const currentValue = value[key];
    if (currentValue === undefined) {
      continue;
    }
    score += 1;
    if (Array.isArray(propertySchema.enum) && propertySchema.enum.length === 1) {
      const enumValue = propertySchema.enum[0];
      if (typeof enumValue === "string" && currentValue === enumValue) {
        score += 4;
      }
    }
  }
  return score;
}

function resolveDisplaySchema(
  schema: Record<string, unknown>,
  value: unknown,
): DisplayObjectSchema | null {
  const direct = readObjectSchema(schema);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return null;
  }

  const variants = readVariantSchemas(schema);
  if (variants.length === 0) {
    return null;
  }

  return (
    variants.toSorted(
      (left, right) => detectVariantScore(right, value) - detectVariantScore(left, value),
    )[0] ?? null
  );
}

function formatFieldLabel(key: string, schema: Record<string, unknown>): string {
  if (typeof schema.title === "string" && schema.title.trim().length > 0) {
    return schema.title;
  }
  return key;
}

function renderFieldValue(value: unknown): React.ReactNode {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="text-sm text-fg">{String(value)}</span>;
  }
  return <StructuredJsonDisplay value={value} maxDepth={3} />;
}

export function StructuredJsonSchemaDisplay({
  schema,
  value,
  className,
  ...props
}: StructuredJsonSchemaDisplayProps): React.ReactElement {
  const resolvedSchema = React.useMemo(() => resolveDisplaySchema(schema, value), [schema, value]);
  if (!resolvedSchema || !isRecord(value)) {
    return <StructuredJsonDisplay className={className} value={value} {...props} />;
  }

  const knownRows = resolvedSchema.propertyOrder.flatMap((key) => {
    const currentValue = value[key];
    if (currentValue === undefined) {
      return [];
    }
    return [
      {
        key,
        label: formatFieldLabel(key, resolvedSchema.properties[key]!),
        value: currentValue,
      },
    ];
  });

  const additionalEntries = resolvedSchema.additionalProperties
    ? Object.entries(value).filter(
        ([key]) => !Object.prototype.hasOwnProperty.call(resolvedSchema.properties, key),
      )
    : [];

  if (knownRows.length === 0 && additionalEntries.length === 0) {
    return <StructuredJsonDisplay className={className} value={value} {...props} />;
  }

  return (
    <div
      className={cn("grid gap-3 rounded-md border border-border/70 bg-bg px-3 py-3", className)}
      {...props}
    >
      {knownRows.map((row) => (
        <div key={row.key} className="grid gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
            {row.label}
          </div>
          {renderFieldValue(row.value)}
        </div>
      ))}

      {additionalEntries.length > 0 ? (
        <div className="grid gap-1">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
            Additional fields
          </div>
          <StructuredJsonDisplay value={Object.fromEntries(additionalEntries)} maxDepth={3} />
        </div>
      ) : null}
    </div>
  );
}
