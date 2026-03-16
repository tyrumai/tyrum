import type { MemoryDal } from "../../src/modules/memory/memory-dal.js";

export async function listWatcherEpisodes(memoryDal: MemoryDal): Promise<any[]> {
  const { items } = await memoryDal.list({
    filter: { kinds: ["episode"], provenance: { channels: ["watcher"] } },
    limit: 2000,
  });
  return items;
}
