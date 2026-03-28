import { expect, it } from "vitest";
import type { WorkboardDalFixture } from "./workboard-dal.test-support.js";

export function registerItemsPaginationAndWipTests(fixture: WorkboardDalFixture): void {
  it("paginates work item lists with cursor", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const one = await dal.createItem({
      scope,
      item: { kind: "action", title: "1", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const two = await dal.createItem({
      scope,
      item: { kind: "action", title: "2", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });
    const three = await dal.createItem({
      scope,
      item: { kind: "action", title: "3", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });

    const page1 = await dal.listItems({ scope, limit: 2 });
    expect(page1.items.map((i) => i.work_item_id)).toEqual([three.work_item_id, two.work_item_id]);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await dal.listItems({ scope, limit: 2, cursor: page1.next_cursor });
    expect(page2.items.map((i) => i.work_item_id)).toEqual([one.work_item_id]);
    expect(page2.next_cursor).toBeUndefined();
  });

  it("enforces item-level WIP cap on operator transitions", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const [first, second, third] = await Promise.all([
      dal.createItem({
        scope,
        item: {
          kind: "action",
          title: "Item 1",
          created_from_conversation_key: "agent:default:main",
        },
        createdAtIso: "2026-02-27T00:00:00.000Z",
      }),
      dal.createItem({
        scope,
        item: {
          kind: "action",
          title: "Item 2",
          created_from_conversation_key: "agent:default:main",
        },
        createdAtIso: "2026-02-27T00:00:01.000Z",
      }),
      dal.createItem({
        scope,
        item: {
          kind: "action",
          title: "Item 3",
          created_from_conversation_key: "agent:default:main",
        },
        createdAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    for (const item of [first, second, third]) {
      await dal.updateItem({
        scope,
        work_item_id: item.work_item_id,
        patch: { acceptance: { done: true } },
        updatedAtIso: "2026-02-27T00:00:02.500Z",
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
    }

    await dal.transitionItem({
      scope,
      work_item_id: first.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: second.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: third.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
    });

    await dal.transitionItem({
      scope,
      work_item_id: first.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:04.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: second.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:04.001Z",
    });
    await expect(
      dal.transitionItem({
        scope,
        work_item_id: third.work_item_id,
        status: "doing",
        occurredAtIso: "2026-02-27T00:00:04.002Z",
      }),
    ).rejects.toMatchObject({
      code: "wip_limit_exceeded",
      details: { from: "ready", to: "doing", limit: 2, current: 2 },
    });
  });
}
