import { describe, expect, it, vi } from "vitest";

const pruneSpy = vi.hoisted(() => vi.fn((input: unknown) => input));

vi.mock("../src/providers/a11y/prune-ui-tree.js", () => ({
  DEFAULT_A11Y_MAX_DEPTH: 32,
  pruneUiTree: pruneSpy,
}));

import { AtSpiDesktopA11yBackend } from "../src/providers/backends/atspi-a11y-backend.js";

describe("AtSpiDesktopA11yBackend snapshot pruning", () => {
  it("does not prune the snapshot tree (provider owns pruning)", async () => {
    const backend = new AtSpiDesktopA11yBackend() as any;

    backend.resolveRootAccessible = vi.fn(async () => ({ busName: "app", objectPath: "/root" }));
    backend.getChildren = vi.fn(async () => []);
    backend.describeAccessible = vi.fn(async (ref: { busName: string; objectPath: string }) => ({
      elementRef: `atspi:${ref.busName}|${ref.objectPath}`,
      role: "frame",
      name: "Root",
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      actions: [],
      states: [],
    }));

    await backend.snapshot({
      op: "snapshot",
      include_tree: true,
      max_nodes: 4,
      max_text_chars: 512,
    });

    expect(pruneSpy).not.toHaveBeenCalled();
  });
});

