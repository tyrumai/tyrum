# Memory v1 Retrieval Injection (Budgeted Digest) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace markdown memory prompt injection with a **Memory v1 digest** that is budgeted, attributed, sensitivity-aware, and injected during context assembly for model inference turns.

**Architecture:** Add `AgentConfig.memory.v1` digest config, implement a deterministic digest builder backed by `MemoryV1Dal` (keyword + structured; optional semantic), and wire it into `AgentRuntime` prompt assembly.

**Tech Stack:** Node.js (TypeScript, ESM), SQLite/Postgres StateStore, Vitest, `@tyrum/schemas`.

---

### Task 1: Add Memory v1 digest config to `AgentConfig`

**Files:**

- Modify: `packages/schemas/src/agent.ts`
- Modify: `packages/schemas/tests/agent.test.ts`
- Modify: `packages/gateway/src/modules/agent/home.ts`

**Step 1: Write the failing test**

- Add schema tests covering:
  - defaults for `memory.v1.enabled` and budgets
  - parsing of `memory.v1.allow_sensitivities`

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/schemas/tests/agent.test.ts`
Expected: FAIL (unknown config fields / missing defaults).

**Step 3: Write minimal implementation**

- Extend `AgentMemoryConfig` with a `v1` subsection and conservative defaults.
- Update `DEFAULT_AGENT_YAML` to include the new subsection (documented defaults).

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/schemas/tests/agent.test.ts`
Expected: PASS.

---

### Task 2: Implement deterministic, budgeted digest builder

**Files:**

- Create: `packages/gateway/src/modules/memory/v1-digest.ts`
- Create: `packages/gateway/tests/unit/memory-v1-digest.test.ts`

**Step 1: Write the failing test**

- Add unit tests that:
  - enforce per-kind and total budgets (items + chars)
  - ensure deterministic selection/order for ties
  - exclude `sensitive` by default

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/gateway/tests/unit/memory-v1-digest.test.ts`
Expected: FAIL (digest builder not implemented).

**Step 3: Write minimal implementation**

- `buildMemoryV1Digest({ dal, query, config, agentId })`:
  - structured: list pinned items (keys/tags)
  - keyword: `dal.search(...)`
  - semantic (optional): best-effort hits if enabled
  - dedupe + select deterministically under budgets
  - format output with `memory_item_id` + compact provenance

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/gateway/tests/unit/memory-v1-digest.test.ts`
Expected: PASS.

---

### Task 3: Wire digest into `AgentRuntime` (replace markdown injection)

**Files:**

- Modify: `packages/gateway/src/modules/agent/runtime/agent-runtime.ts`
- Modify: `packages/gateway/src/modules/agent/runtime/prompts.ts` (if needed)
- Create: `packages/gateway/tests/unit/agent-runtime-memory-v1-injection.test.ts`

**Step 1: Write the failing test**

- Add a runtime unit test that:
  - creates Memory v1 items via `MemoryV1Dal`
  - runs `AgentRuntime.turn(...)`
  - asserts the stitched prompt includes `Memory digest:` and selected IDs/snippets
  - asserts markdown “Long-term memory matches” is not injected

**Step 2: Run test to verify it fails**

Run: `pnpm test packages/gateway/tests/unit/agent-runtime-memory-v1-injection.test.ts`
Expected: FAIL (digest not injected / markdown still injected).

**Step 3: Write minimal implementation**

- Build digest from Memory v1 during `prepareTurn()` and inject it as `Memory digest:\n...`.
- Remove the markdown-memory search + “Long-term memory matches” prompt part (read path).
- Keep markdown memory write-path behavior unchanged for now (out of scope).

**Step 4: Run test to verify it passes**

Run: `pnpm test packages/gateway/tests/unit/agent-runtime-memory-v1-injection.test.ts`
Expected: PASS.

