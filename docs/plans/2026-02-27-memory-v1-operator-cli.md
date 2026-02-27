# Memory v1 Operator CLI Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `tyrum-cli memory` subcommands (search/list/read/create/update/delete/forget/export) that manage Memory v1 via `@tyrum/client` against a local gateway.

**Architecture:** Extend `@tyrum/cli` (`packages/cli/src/index.ts`) with a `memory` command group that parses flags, then uses `runOperatorWsCommand()` to call `TyrumClient.memory*()` helpers and prints JSON results.

**Tech Stack:** Node.js 24, TypeScript (ESM), Vitest, pnpm workspace.

---

### Task 1: Add RED tests (operator CLI → @tyrum/client WS)

**Files:**

- Modify: `packages/cli/tests/unit/operator-commands.test.ts`

**Step 1: Add WS spies + mocked methods**

Add spies:

```ts
const { wsMemorySearchSpy, wsMemoryListSpy, wsMemoryGetSpy, wsMemoryCreateSpy, wsMemoryUpdateSpy, wsMemoryDeleteSpy, wsMemoryForgetSpy, wsMemoryExportSpy } = vi.hoisted(() => ({ ... }));
```

Add mocked methods on `TyrumClient`:

```ts
memorySearch(payload: unknown) { return wsMemorySearchSpy(payload); }
// ... etc
```

**Step 2: Add one test per command**

Example:

```ts
it("runs `memory search` via @tyrum/client WS", async () => {
  wsMemorySearchSpy.mockResolvedValue({ v: 1, hits: [] });
  const code = await runCli(["memory", "search", "--query", "hello"]);
  expect(code).toBe(0);
  expect(wsMemorySearchSpy).toHaveBeenCalledWith({ v: 1, query: "hello" });
});
```

**Step 3: Run to confirm failures (RED)**

Run:
`pnpm exec vitest run packages/cli/tests/unit/operator-commands.test.ts -t "memory"`

Expected: failures due to unsupported `memory` CLI commands.

---

### Task 2: Implement CLI parsing for `memory/*` (GREEN)

**Files:**

- Modify: `packages/cli/src/index.ts`

**Step 1: Add new `CliCommand` variants**

Add kinds:

- `memory_search`, `memory_list`, `memory_read`, `memory_create`, `memory_update`, `memory_delete`, `memory_forget`, `memory_export`

**Step 2: Extend `printCliHelp()`**

Add usage lines:

- `tyrum-cli memory search --query <text> [--filter <json>] [--limit <n>] [--cursor <cursor>]`
- `tyrum-cli memory list [--filter <json>] [--limit <n>] [--cursor <cursor>]`
- `tyrum-cli memory read --id <memory-item-id>`
- `tyrum-cli memory create --item <json>`
- `tyrum-cli memory update --id <memory-item-id> --patch <json>`
- `tyrum-cli memory delete --id <memory-item-id> [--reason <text>]`
- `tyrum-cli memory forget --selectors <json> --confirm FORGET`
- `tyrum-cli memory export [--filter <json>] [--include-tombstones]`

**Step 3: Extend `parseCliArgs()`**

Add:

```ts
if (first === "memory") {
  // parse subcommands + flags, return the new CliCommand kinds
}
```

Parse JSON flags with `JSON.parse` and validate basic shapes:

- `--filter`: JSON object
- `--item`: JSON object (fill default provenance if missing)
- `--patch`: JSON object
- `--selectors`: JSON array

---

### Task 3: Implement WS execution for memory commands (GREEN)

**Files:**

- Modify: `packages/cli/src/index.ts`

**Step 1: Add `runCli` handlers**

Implement:

```ts
if (command.kind === "memory_search") {
  return await runOperatorWsCommand(tyrumHome, "memory.search", (client) =>
    client.memorySearch({
      v: 1,
      query: command.query,
      filter: command.filter,
      limit: command.limit,
      cursor: command.cursor,
    }),
  );
}
```

Repeat for other commands, mapping to:

- `read` → `client.memoryGet({ v: 1, memory_item_id })`
- `create` → `client.memoryCreate({ v: 1, item })`
- `update` → `client.memoryUpdate({ v: 1, memory_item_id, patch })`
- `delete` → `client.memoryDelete({ v: 1, memory_item_id, reason })`
- `forget` → `client.memoryForget({ v: 1, confirm: "FORGET", selectors })`
- `export` → `client.memoryExport({ v: 1, filter, include_tombstones })`

---

### Task 4: Verify + ship

**Step 1: Run full verification**

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`

**Step 2: Push + open PR**

- Branch: `664-cli-memory-v1-commands`
- PR title: `feat(cli): Memory v1 commands (search/list/read/create/update/delete/forget/export) (#664)`
- PR body includes: `Closes #664` + local verification output
