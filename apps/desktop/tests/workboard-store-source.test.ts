import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("workboard-store source", () => {
  it("delegates upsertWorkItem to upsertByStringKey", () => {
    const store = readFileSync(
      join(import.meta.dirname, "../src/renderer/lib/workboard-store.ts"),
      "utf-8",
    );

    expect(store).toContain("return upsertByStringKey(items, next, (item) => item.work_item_id);");
  });
});
