import { Ajv2019 } from "ajv/dist/2019.js";
import { normalizePositiveInt } from "./normalize-positive-int.js";

export type PlaybookOutputKind = "text" | "json";
export type JsonSchema = boolean | Record<string, unknown>;

export interface PlaybookOutputContract {
  kind: PlaybookOutputKind;
  schema?: JsonSchema;
}

export const DEFAULT_MAX_OUTPUT_BYTES = 32_768;
export const MAX_OUTPUT_BYTES_HARD_LIMIT = 512_000;

function createOutputSchemaValidator(): Ajv2019 {
  return new Ajv2019({ allErrors: true, strict: false, unevaluated: true });
}

export function resolveMaxOutputBytes(args: Record<string, unknown>): number {
  const requested = normalizePositiveInt(args["max_output_bytes"]);
  if (requested === undefined) return DEFAULT_MAX_OUTPUT_BYTES;
  return Math.min(requested, MAX_OUTPUT_BYTES_HARD_LIMIT);
}

export function parsePlaybookOutputContract(
  args: Record<string, unknown>,
): PlaybookOutputContract | undefined {
  const meta = args["__playbook"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;

  const output = (meta as Record<string, unknown>)["output"];
  if (output === "text" || output === "json") {
    return { kind: output };
  }
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined;

  const outputObj = output as Record<string, unknown>;
  const kind = outputObj["type"];
  if (kind !== "text" && kind !== "json") return undefined;

  const schema = outputObj["schema"];
  if (schema === undefined) return { kind };
  if (typeof schema === "boolean") return { kind, schema };
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return { kind, schema: schema as Record<string, unknown> };
  }
  return { kind };
}

export function validateJsonAgainstSchema(value: unknown, schema: JsonSchema): string | undefined {
  try {
    const validator = createOutputSchemaValidator();
    const validate = validator.compile(schema);
    if (validate(value)) return undefined;
    return validator.errorsText(validate.errors, { separator: "; " });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `invalid output schema: ${message}`;
  }
}
