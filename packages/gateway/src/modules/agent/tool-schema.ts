import type { ToolDescriptor } from "./tools.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasObjectRootType(schema: Record<string, unknown>): boolean {
  const type = schema["type"];
  if (type === "object") return true;
  return Array.isArray(type) && type.includes("object");
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

  return { ok: true, schema };
}

export function validateToolDescriptorInputSchema(
  descriptor: Pick<ToolDescriptor, "id" | "inputSchema">,
): { ok: true; schema: Record<string, unknown> } | { ok: false; error: string } {
  const schema = descriptor.inputSchema ?? { type: "object", additionalProperties: true };
  const validated = validateModelToolInputSchema(schema);
  if (validated.ok) return validated;
  return { ok: false, error: `${descriptor.id}: ${validated.error.trim()}` };
}
