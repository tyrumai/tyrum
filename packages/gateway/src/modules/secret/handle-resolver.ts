import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "./provider.js";

export interface SecretHandleResolver {
  getById(handleId: string): Promise<SecretHandle | null>;
  resolveById(handleId: string): Promise<string | null>;
  resolveScopes(handleIds: readonly string[]): Promise<string[]>;
  refresh(): Promise<void>;
}

export function createSecretHandleResolver(secretProvider: SecretProvider): SecretHandleResolver {
  let cache: Map<string, SecretHandle> | undefined;

  async function load(): Promise<Map<string, SecretHandle>> {
    if (cache) return cache;
    const handles = await secretProvider.list();
    cache = new Map(handles.map((h) => [h.handle_id, h]));
    return cache;
  }

  async function getById(handleId: string): Promise<SecretHandle | null> {
    const trimmed = handleId.trim();
    if (!trimmed) return null;

    const handles = await load();
    return handles.get(trimmed) ?? null;
  }

  return {
    getById,
    async resolveById(handleId: string): Promise<string | null> {
      const handle = await getById(handleId);
      if (!handle) return null;
      return await secretProvider.resolve(handle);
    },
    async resolveScopes(handleIds: readonly string[]): Promise<string[]> {
      const scopes = new Set<string>();
      for (const handleId of handleIds) {
        const handle = await getById(handleId);
        if (handle?.scope) {
          scopes.add(`${handle.provider}:${handle.scope}`);
          continue;
        }
        const trimmed = handleId.trim();
        if (trimmed.length > 0) {
          scopes.add(trimmed);
        }
      }
      return [...scopes];
    },
    async refresh(): Promise<void> {
      cache = undefined;
      await load();
    },
  };
}

const SECRET_HANDLE_PREFIX = "secret:";

export async function resolveSecretsWithHandles(
  args: unknown,
  resolver: SecretHandleResolver,
): Promise<{ resolved: unknown; secrets: string[] }> {
  const secrets: string[] = [];

  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === "string" && value.startsWith(SECRET_HANDLE_PREFIX)) {
      const handleId = value.slice(SECRET_HANDLE_PREFIX.length);
      const resolved = await resolver.resolveById(handleId);
      if (resolved !== null) {
        secrets.push(resolved);
        return resolved;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return await Promise.all(value.map(walk));
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        out[key] = await walk(entry);
      }
      return out;
    }
    return value;
  };

  return { resolved: await walk(args), secrets };
}
