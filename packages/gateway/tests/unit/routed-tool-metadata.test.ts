import { describe, expect, it } from "vitest";
import {
  buildRoutedToolApprovalPromptSuffix,
  buildRoutedToolExecutionMetadata,
} from "../../src/modules/agent/routed-tool-metadata.js";

describe("routed-tool-metadata", () => {
  it("formats approval suffixes from precomputed explicit routing metadata", () => {
    const routing = buildRoutedToolExecutionMetadata("tool.desktop.act", {
      node_id: "node-1",
      target: { kind: "a11y", role: "button", name: "Submit", states: [] },
      action: { kind: "click" },
    });

    expect(routing).toEqual({
      requested_node_id: "node-1",
      selected_node_id: "node-1",
      selection_mode: "explicit",
    });
    expect(buildRoutedToolApprovalPromptSuffix(routing)).toBe(" on node 'node-1'");
  });

  it("omits approval suffixes when routed metadata is absent", () => {
    expect(buildRoutedToolApprovalPromptSuffix(undefined)).toBe("");
  });
});
