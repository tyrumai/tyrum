import { describe, expect, it, vi } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("command dispatcher plugin catalog integration", () => {
  it("uses the tenant plugin catalog before the global plugin registry", async () => {
    const tryExecuteTenantCommand = vi.fn(async () => ({ output: "tenant plugin command" }));
    const tryExecuteGlobalCommand = vi.fn(async () => ({ output: "global plugin command" }));

    const result = await executeCommand("/echo hello", {
      tenantId: DEFAULT_TENANT_ID,
      pluginCatalogProvider: {
        loadGlobalRegistry: vi.fn(),
        loadTenantRegistry: vi.fn(async () => ({
          tryExecuteCommand: tryExecuteTenantCommand,
        })),
        invalidateTenantRegistry: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      } as never,
      plugins: {
        tryExecuteCommand: tryExecuteGlobalCommand,
      } as never,
    });

    expect(result.output).toBe("tenant plugin command");
    expect(tryExecuteTenantCommand).toHaveBeenCalledWith("/echo hello");
    expect(tryExecuteGlobalCommand).not.toHaveBeenCalled();
  });
});
