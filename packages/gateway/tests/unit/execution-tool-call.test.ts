import { describe, expect, it } from "vitest";
import { canonicalizeToolMatchTarget } from "../../src/modules/policy/match-target.js";
import { toolCallFromAction } from "../../src/modules/execution/engine/tool-call.js";

describe("toolCallFromAction", () => {
  it("normalizes CLI actions to tool.exec", () => {
    const tool = toolCallFromAction({
      type: "CLI",
      args: {
        cmd: "git",
        args: ["status", "--short"],
      },
    });

    expect(tool).toEqual({
      toolId: "tool.exec",
      matchTarget: canonicalizeToolMatchTarget("tool.exec", {
        command: "git status --short",
      }),
    });
  });

  it("normalizes Http actions to tool.http.fetch and keeps the url", () => {
    const tool = toolCallFromAction({
      type: "Http",
      args: {
        url: "https://example.com/health",
      },
    });

    expect(tool).toEqual({
      toolId: "tool.http.fetch",
      matchTarget: canonicalizeToolMatchTarget("tool.http.fetch", {
        url: "https://example.com/health",
      }),
      url: "https://example.com/health",
    });
  });

  it("falls back to action-based tool ids for non-tool actions", () => {
    const tool = toolCallFromAction({
      type: "Message",
      args: {
        body: "hi",
      },
    });

    expect(tool).toEqual({
      toolId: "action.Message",
      matchTarget: canonicalizeToolMatchTarget("action.Message", {
        body: "hi",
      }),
    });
  });
});
