import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "./provider.js";

export interface SecretHandleResolver {
  resolveById(handleId: string): Promise<string | null>;
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

  return {
    async resolveById(handleId: string): Promise<string | null> {
      const trimmed = handleId.trim();
      if (!trimmed) return null;

      const handles = await load();
      const handle = handles.get(trimmed);
      if (!handle) return null;
      return await secretProvider.resolve(handle);
    },
    async refresh(): Promise<void> {
      cache = undefined;
      await load();
    },
  };
}
