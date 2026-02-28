import type { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";

export async function listWatcherEpisodes(memoryV1Dal: MemoryV1Dal): Promise<any[]> {
  const { items } = await memoryV1Dal.list({
    agentId: "default",
    filter: { kinds: ["episode"], provenance: { channels: ["watcher"] } },
    limit: 2000,
  });
  return items;
}
