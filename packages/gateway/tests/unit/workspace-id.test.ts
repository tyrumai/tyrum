import { describe, expect, it } from "vitest";
import { resolveWorkspaceId } from "../../src/modules/workspace/id.js";
import { DEFAULT_WORKSPACE_ID } from "@tyrum/schemas";

describe("resolveWorkspaceId", () => {
  it("returns DEFAULT_WORKSPACE_ID when env var not set", () => {
    const result = resolveWorkspaceId({});
    expect(result).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("returns DEFAULT_WORKSPACE_ID when env var is empty string", () => {
    const result = resolveWorkspaceId({ TYRUM_WORKSPACE_ID: "" });
    expect(result).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("returns DEFAULT_WORKSPACE_ID when env var is whitespace only", () => {
    const result = resolveWorkspaceId({ TYRUM_WORKSPACE_ID: "   " });
    expect(result).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("returns parsed workspace ID when env var is set", () => {
    const result = resolveWorkspaceId({ TYRUM_WORKSPACE_ID: "my-workspace" });
    expect(result).toBe("my-workspace");
  });

  it("trims whitespace from env var value", () => {
    const result = resolveWorkspaceId({ TYRUM_WORKSPACE_ID: "  my-workspace  " });
    expect(result).toBe("my-workspace");
  });
});
