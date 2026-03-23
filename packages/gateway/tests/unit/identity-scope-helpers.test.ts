import { describe, expect, it } from "vitest";
import {
  requireTenantIdValue,
  normalizeScopeKeys,
  ScopeNotFoundError,
  DEFAULT_TENANT_KEY,
  DEFAULT_AGENT_KEY,
  DEFAULT_WORKSPACE_KEY,
} from "../../src/modules/identity/scope.js";

describe("requireTenantIdValue", () => {
  it("returns trimmed tenant id for valid string", () => {
    expect(requireTenantIdValue("  tenant-1  ")).toBe("tenant-1");
  });

  it("throws for null", () => {
    expect(() => requireTenantIdValue(null)).toThrow("tenantId is required");
  });

  it("throws for undefined", () => {
    expect(() => requireTenantIdValue(undefined)).toThrow("tenantId is required");
  });

  it("throws for empty string", () => {
    expect(() => requireTenantIdValue("")).toThrow("tenantId is required");
  });

  it("throws for whitespace-only string", () => {
    expect(() => requireTenantIdValue("   ")).toThrow("tenantId is required");
  });

  it("uses custom message when provided", () => {
    expect(() => requireTenantIdValue(null, "custom error")).toThrow("custom error");
  });
});

describe("normalizeScopeKeys", () => {
  it("returns all defaults when no input", () => {
    expect(normalizeScopeKeys()).toEqual({
      tenantKey: DEFAULT_TENANT_KEY,
      agentKey: DEFAULT_AGENT_KEY,
      workspaceKey: DEFAULT_WORKSPACE_KEY,
    });
  });

  it("returns all defaults for undefined input", () => {
    expect(normalizeScopeKeys(undefined)).toEqual({
      tenantKey: DEFAULT_TENANT_KEY,
      agentKey: DEFAULT_AGENT_KEY,
      workspaceKey: DEFAULT_WORKSPACE_KEY,
    });
  });

  it("returns all defaults for empty object", () => {
    expect(normalizeScopeKeys({})).toEqual({
      tenantKey: DEFAULT_TENANT_KEY,
      agentKey: DEFAULT_AGENT_KEY,
      workspaceKey: DEFAULT_WORKSPACE_KEY,
    });
  });

  it("preserves valid keys", () => {
    expect(
      normalizeScopeKeys({
        tenantKey: "my-tenant",
        agentKey: "my-agent",
        workspaceKey: "my-workspace",
      }),
    ).toEqual({
      tenantKey: "my-tenant",
      agentKey: "my-agent",
      workspaceKey: "my-workspace",
    });
  });

  it("trims keys and falls back to defaults for empty strings", () => {
    expect(
      normalizeScopeKeys({
        tenantKey: "  ",
        agentKey: "",
        workspaceKey: "  ws  ",
      }),
    ).toEqual({
      tenantKey: DEFAULT_TENANT_KEY,
      agentKey: DEFAULT_AGENT_KEY,
      workspaceKey: "ws",
    });
  });
});

describe("ScopeNotFoundError", () => {
  it("creates an error with code=not_found", () => {
    const err = new ScopeNotFoundError("not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("not_found");
    expect(err.name).toBe("ScopeNotFoundError");
    expect(err.message).toBe("not found");
  });

  it("accepts optional details", () => {
    const err = new ScopeNotFoundError("not found", { tenantId: "t1" });
    expect(err.details).toEqual({ tenantId: "t1" });
  });
});
