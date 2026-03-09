import { describe, expect, it } from "vitest";
import { canonicalizeToolMatchTarget } from "../../src/modules/policy/match-target.js";
import { toolCallFromAction } from "../../src/modules/execution/engine/tool-call.js";

describe("toolCallFromAction", () => {
  it("normalizes CLI actions to bash", () => {
    const tool = toolCallFromAction({
      type: "CLI",
      args: {
        cmd: "git",
        args: ["status", "--short"],
      },
    });

    expect(tool).toEqual({
      toolId: "bash",
      matchTarget: canonicalizeToolMatchTarget("bash", {
        command: "git status --short",
      }),
    });
  });

  it("normalizes Http actions to webfetch and keeps the url", () => {
    const tool = toolCallFromAction({
      type: "Http",
      args: {
        url: "https://example.com/health",
      },
    });

    expect(tool).toEqual({
      toolId: "webfetch",
      matchTarget: canonicalizeToolMatchTarget("webfetch", {
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
