import { expect, it } from "vitest";
import type { WorkboardDalFixture } from "./workboard-dal.test-support.js";

export function registerTransitionGuardTests(fixture: WorkboardDalFixture): void {
  it("rechecks readiness before transitioning blocked work back to doing", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Blocked readiness recheck",
        acceptance: { done: true },
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:02:00.000Z",
    });

    await dal.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "done",
      provenance_json: { source: "test" },
    });
    await dal.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });

    await dal.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:02:01.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:02:02.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "blocked",
      occurredAtIso: "2026-02-27T00:02:03.000Z",
      reason: "waiting",
    });
    await dal.deleteStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
    });

    await expect(
      dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "doing",
        occurredAtIso: "2026-02-27T00:02:04.000Z",
      }),
    ).rejects.toMatchObject({
      code: "readiness_gate_failed",
      details: {
        from: "blocked",
        to: "doing",
        reasons: ["size_missing"],
      },
    });
  });
}
