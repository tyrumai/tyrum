import type { TyrumClient } from "@tyrum/client";

import type { CliCommand } from "../cli-command.js";
import { runOperatorWsCommand } from "../operator-clients.js";

export async function handleMemorySearch(
  command: Extract<CliCommand, { kind: "memory_search" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.search", async (client) => {
    type Payload = Parameters<TyrumClient["memorySearch"]>[0];
    const payload: Payload = {
      v: 1,
      query: command.query,
      ...(command.filter !== undefined ? { filter: command.filter as Payload["filter"] } : {}),
      ...(command.limit !== undefined ? { limit: command.limit } : {}),
      ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
    };
    return await client.memorySearch(payload);
  });
}

export async function handleMemoryList(
  command: Extract<CliCommand, { kind: "memory_list" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.list", async (client) => {
    type Payload = Parameters<TyrumClient["memoryList"]>[0];
    const payload: Payload = {
      v: 1,
      ...(command.filter !== undefined ? { filter: command.filter as Payload["filter"] } : {}),
      ...(command.limit !== undefined ? { limit: command.limit } : {}),
      ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
    };
    return await client.memoryList(payload);
  });
}

export async function handleMemoryRead(
  command: Extract<CliCommand, { kind: "memory_read" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.get", async (client) => {
    return await client.memoryGet({ v: 1, memory_item_id: command.id });
  });
}

export async function handleMemoryCreate(
  command: Extract<CliCommand, { kind: "memory_create" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.create", async (client) => {
    type Payload = Parameters<TyrumClient["memoryCreate"]>[0];
    const payload: Payload = { v: 1, item: command.item as Payload["item"] };
    return await client.memoryCreate(payload);
  });
}

export async function handleMemoryUpdate(
  command: Extract<CliCommand, { kind: "memory_update" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.update", async (client) => {
    type Payload = Parameters<TyrumClient["memoryUpdate"]>[0];
    const payload: Payload = {
      v: 1,
      memory_item_id: command.id,
      patch: command.patch as Payload["patch"],
    };
    return await client.memoryUpdate(payload);
  });
}

export async function handleMemoryDelete(
  command: Extract<CliCommand, { kind: "memory_delete" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.delete", async (client) => {
    type Payload = Parameters<TyrumClient["memoryDelete"]>[0];
    const payload: Payload = {
      v: 1,
      memory_item_id: command.id,
      ...(command.reason !== undefined ? { reason: command.reason } : {}),
    };
    return await client.memoryDelete(payload);
  });
}

export async function handleMemoryForget(
  command: Extract<CliCommand, { kind: "memory_forget" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.forget", async (client) => {
    type Payload = Parameters<TyrumClient["memoryForget"]>[0];
    const payload: Payload = {
      v: 1,
      confirm: "FORGET",
      selectors: command.selectors as Payload["selectors"],
    };
    return await client.memoryForget(payload);
  });
}

export async function handleMemoryExport(
  command: Extract<CliCommand, { kind: "memory_export" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "memory.export", async (client) => {
    type Payload = Parameters<TyrumClient["memoryExport"]>[0];
    const payload: Payload = {
      v: 1,
      ...(command.filter !== undefined ? { filter: command.filter as Payload["filter"] } : {}),
      include_tombstones: command.include_tombstones,
    };
    return await client.memoryExport(payload);
  });
}
