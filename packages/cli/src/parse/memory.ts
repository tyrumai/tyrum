import type { CliCommand } from "../cli-command.js";

import {
  parseJsonArray,
  parseJsonObject,
  parseNonEmptyString,
  parsePositiveInt,
} from "./common.js";

export function parseMemoryCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second) {
    throw new Error(
      "memory requires a subcommand (search|list|read|create|update|delete|forget|export)",
    );
  }

  if (second === "search") return parseMemorySearch(argv);
  if (second === "list") return parseMemoryList(argv);
  if (second === "read") return parseMemoryRead(argv);
  if (second === "create") return parseMemoryCreate(argv);
  if (second === "update") return parseMemoryUpdate(argv);
  if (second === "delete") return parseMemoryDelete(argv);
  if (second === "forget") return parseMemoryForget(argv);
  if (second === "export") return parseMemoryExport(argv);

  throw new Error(`unknown memory subcommand '${second}'`);
}

function parseMemorySearch(argv: readonly string[]): CliCommand {
  let query: string | undefined;
  let filter: Record<string, unknown> | undefined;
  let limit: number | undefined;
  let cursor: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--query") {
      query = parseNonEmptyString(argv[i + 1], "--query");
      i += 1;
      continue;
    }

    if (arg === "--filter") {
      filter = parseJsonObject(argv[i + 1], "--filter");
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      limit = parsePositiveInt(argv[i + 1], "--limit");
      i += 1;
      continue;
    }

    if (arg === "--cursor") {
      cursor = parseNonEmptyString(argv[i + 1], "--cursor");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.search argument '${arg}'`);
    }
    throw new Error(`unexpected memory.search argument '${arg}'`);
  }

  if (!query) throw new Error("memory search requires --query <text>");
  return { kind: "memory_search", query, filter, limit, cursor };
}

function parseMemoryList(argv: readonly string[]): CliCommand {
  let filter: Record<string, unknown> | undefined;
  let limit: number | undefined;
  let cursor: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--filter") {
      filter = parseJsonObject(argv[i + 1], "--filter");
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      limit = parsePositiveInt(argv[i + 1], "--limit");
      i += 1;
      continue;
    }

    if (arg === "--cursor") {
      cursor = parseNonEmptyString(argv[i + 1], "--cursor");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.list argument '${arg}'`);
    }
    throw new Error(`unexpected memory.list argument '${arg}'`);
  }

  return { kind: "memory_list", filter, limit, cursor };
}

function parseMemoryRead(argv: readonly string[]): CliCommand {
  let id: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--id") {
      id = parseNonEmptyString(argv[i + 1], "--id");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.read argument '${arg}'`);
    }
    throw new Error(`unexpected memory.read argument '${arg}'`);
  }

  if (!id) throw new Error("memory read requires --id <memory-item-id>");
  return { kind: "memory_read", id };
}

function parseMemoryCreate(argv: readonly string[]): CliCommand {
  let item: Record<string, unknown> | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--item") {
      item = { ...parseJsonObject(argv[i + 1], "--item") };
      if (item["provenance"] === undefined) {
        item["provenance"] = { source_kind: "operator", channel: "cli" };
      }
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.create argument '${arg}'`);
    }
    throw new Error(`unexpected memory.create argument '${arg}'`);
  }

  if (!item) throw new Error("memory create requires --item <json>");
  return { kind: "memory_create", item };
}

function parseMemoryUpdate(argv: readonly string[]): CliCommand {
  let id: string | undefined;
  let patch: Record<string, unknown> | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--id") {
      id = parseNonEmptyString(argv[i + 1], "--id");
      i += 1;
      continue;
    }

    if (arg === "--patch") {
      patch = parseJsonObject(argv[i + 1], "--patch");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.update argument '${arg}'`);
    }
    throw new Error(`unexpected memory.update argument '${arg}'`);
  }

  if (!id) throw new Error("memory update requires --id <memory-item-id>");
  if (!patch) throw new Error("memory update requires --patch <json>");
  return { kind: "memory_update", id, patch };
}

function parseMemoryDelete(argv: readonly string[]): CliCommand {
  let id: string | undefined;
  let reason: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--id") {
      id = parseNonEmptyString(argv[i + 1], "--id");
      i += 1;
      continue;
    }

    if (arg === "--reason") {
      reason = parseNonEmptyString(argv[i + 1], "--reason");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.delete argument '${arg}'`);
    }
    throw new Error(`unexpected memory.delete argument '${arg}'`);
  }

  if (!id) throw new Error("memory delete requires --id <memory-item-id>");
  return { kind: "memory_delete", id, reason };
}

function parseMemoryForget(argv: readonly string[]): CliCommand {
  let confirm: string | undefined;
  let selectors: unknown[] | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--confirm") {
      confirm = parseNonEmptyString(argv[i + 1], "--confirm");
      i += 1;
      continue;
    }

    if (arg === "--selectors") {
      selectors = parseJsonArray(argv[i + 1], "--selectors");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.forget argument '${arg}'`);
    }
    throw new Error(`unexpected memory.forget argument '${arg}'`);
  }

  if (!confirm) throw new Error("memory forget requires --confirm FORGET");
  if (confirm !== "FORGET") throw new Error("--confirm must be FORGET");
  if (!selectors) throw new Error("memory forget requires --selectors <json>");

  return { kind: "memory_forget", selectors };
}

function parseMemoryExport(argv: readonly string[]): CliCommand {
  let filter: Record<string, unknown> | undefined;
  let includeTombstones = false;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--filter") {
      filter = parseJsonObject(argv[i + 1], "--filter");
      i += 1;
      continue;
    }

    if (arg === "--include-tombstones") {
      includeTombstones = true;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported memory.export argument '${arg}'`);
    }
    throw new Error(`unexpected memory.export argument '${arg}'`);
  }

  return { kind: "memory_export", filter, include_tombstones: includeTombstones };
}
