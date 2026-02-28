import { describe, expect, it } from "vitest";
import { DesktopUiTree } from "@tyrum/schemas";
import { pruneUiTree } from "../src/providers/a11y/prune-ui-tree.js";

describe("pruneUiTree", () => {
  it("clamps node fields to schema maxima", () => {
    const input = {
      root: {
        role: "x".repeat(200),
        name: "y".repeat(600),
        value: "z".repeat(600),
        states: ["focused", " ".repeat(10) + "enabled".repeat(20), " ".repeat(5)],
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        actions: ["click", "a".repeat(100), " ".repeat(5) + "b".repeat(100)],
        children: [],
      },
    };

    const pruned = pruneUiTree(input, { maxNodes: 10, maxTextChars: 32_768, maxDepth: 8 });

    const parsed = DesktopUiTree.safeParse(pruned);
    expect(parsed.success).toBe(true);
  });
});

