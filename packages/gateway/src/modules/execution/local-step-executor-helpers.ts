import type { SecretProvider } from "../secret/provider.js";
import {
  createSecretHandleResolver,
  resolveSecretsWithHandles,
} from "../secret/handle-resolver.js";
import type { PlaybookOutputContract } from "./playbook-output-contract.js";
import { validateJsonAgainstSchema } from "./playbook-output-contract.js";
import { resolve, relative, isAbsolute } from "node:path";

export function enforceJsonOutputContract(
  contract: PlaybookOutputContract | undefined,
  rawOutput: string,
  source: string,
  truncated: boolean,
): { parsed?: unknown; error?: string } {
  if (!contract || contract.kind !== "json") return {};

  if (truncated) {
    return { error: `Output contract violated: ${source} was truncated` };
  }

  const parsed = tryParseJson(rawOutput);
  if (parsed === undefined) {
    return { error: `Output contract violated: expected JSON ${source}` };
  }
  if (contract.schema !== undefined) {
    const schemaError = validateJsonAgainstSchema(parsed, contract.schema);
    if (schemaError) {
      return {
        parsed,
        error: `Output contract violated: ${source} failed schema validation (${schemaError})`,
      };
    }
  }

  return { parsed };
}

export function assertSandboxed(baseDir: string, filePath: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(resolvedBase, filePath);
  const rel = relative(resolvedBase, resolvedPath);

  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error(`path escapes workspace: ${filePath}`);
  }
  return resolvedPath;
}

export async function readTextWithLimit(
  response: Response,
  limitBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    return { text: "", truncated: false };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      const remaining = limitBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (value.length <= remaining) {
        chunks.push(value);
        total += value.length;
      } else {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch (err) {
        // Intentional: cancel is best-effort and can fail if the stream is already closed.
        void err;
      }
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const decoder = new TextDecoder("utf-8");
  return { text: decoder.decode(merged), truncated };
}

export function parseHeaderObject(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") headers[k] = v;
  }
  return headers;
}

export function isLikelyJson(contentType: string | null, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/json") || ct.endsWith("+json")) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function isLikelyHtml(contentType: string | null, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) return true;
  return body.trimStart().startsWith("<");
}

export function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    // Intentional: caller treats invalid JSON as "not JSON".
    void err;
    return undefined;
  }
}

export async function resolveSecrets(
  args: unknown,
  secretProvider: SecretProvider | undefined,
): Promise<{ resolved: unknown; secrets: string[] }> {
  if (!secretProvider) return { resolved: args, secrets: [] };
  return await resolveSecretsWithHandles(args, createSecretHandleResolver(secretProvider));
}
