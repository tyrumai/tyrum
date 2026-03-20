import { expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import {
  deleteTerminatedSubagentsBefore,
  updateSubagentRow,
} from "../../src/modules/workboard/subagent-dal-maintenance.js";

const scope = {
  tenant_id: DEFAULT_TENANT_ID,
  agent_id: DEFAULT_AGENT_ID,
  workspace_id: DEFAULT_WORKSPACE_ID,
} as const;

it("updates only the requested subagent columns", async () => {
  const db = {
    get: vi.fn(async () => ({ subagent_id: "subagent-1", status: "paused" })),
  } as never;

  const updated = await updateSubagentRow({
    db,
    scope,
    subagent_id: "subagent-1",
    patch: {
      status: "paused",
      attached_node_id: "node-1",
      close_reason: "paused by operator",
    },
    updatedAtIso: "2026-03-20T00:00:00.000Z",
  });

  expect(updated).toEqual({ subagent_id: "subagent-1", status: "paused" });
  expect(db.get).toHaveBeenCalledWith(
    expect.stringContaining("attached_node_id = ?"),
    expect.arrayContaining([
      "2026-03-20T00:00:00.000Z",
      "paused",
      "node-1",
      "paused by operator",
      DEFAULT_TENANT_ID,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "subagent-1",
    ]),
  );
});

it("returns zero when there are no terminated subagents to delete", async () => {
  const db = {
    all: vi.fn(async () => []),
    run: vi.fn(),
  } as never;

  await expect(
    deleteTerminatedSubagentsBefore({
      db,
      scope,
      closedBeforeIso: "2026-03-20T00:00:00.000Z",
      limit: 10,
    }),
  ).resolves.toBe(0);
  expect(db.run).not.toHaveBeenCalled();
});

it("deletes terminated subagents in bounded batches", async () => {
  const db = {
    all: vi.fn(async () => [{ subagent_id: "subagent-1" }, { subagent_id: "subagent-2" }]),
    run: vi.fn(async () => ({ changes: 2 })),
  } as never;

  const deleted = await deleteTerminatedSubagentsBefore({
    db,
    scope,
    closedBeforeIso: "2026-03-20T00:00:00.000Z",
    limit: 2,
  });

  expect(deleted).toBe(2);
  expect(db.run).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM subagents"), [
    DEFAULT_TENANT_ID,
    DEFAULT_AGENT_ID,
    DEFAULT_WORKSPACE_ID,
    "subagent-1",
    "subagent-2",
  ]);
});
