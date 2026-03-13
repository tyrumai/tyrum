import { describe, expect, it, vi } from "vitest";
import { DesktopEnvironmentLifecycleService } from "../../src/modules/desktop-environments/lifecycle-service.js";

describe("DesktopEnvironmentLifecycleService", () => {
  it("removes runtime resources before deleting the database row", async () => {
    const operations: string[] = [];
    const service = new DesktopEnvironmentLifecycleService(
      {
        get: vi.fn(async () => ({ environment_id: "env-1" })),
        delete: vi.fn(async () => {
          operations.push("delete");
          return true;
        }),
      } as never,
      async (environmentId) => {
        operations.push(`remove:${environmentId}`);
      },
    );

    await expect(
      service.deleteEnvironment({ tenantId: "tenant-1", environmentId: "env-1" }),
    ).resolves.toBe(true);
    expect(operations).toEqual(["remove:env-1", "delete"]);
  });

  it("does nothing when the environment no longer exists", async () => {
    const removeRuntimeResources = vi.fn(async () => {});
    const deleteRow = vi.fn(async () => true);
    const service = new DesktopEnvironmentLifecycleService(
      {
        get: vi.fn(async () => undefined),
        delete: deleteRow,
      } as never,
      removeRuntimeResources,
    );

    await expect(
      service.deleteEnvironment({ tenantId: "tenant-1", environmentId: "env-missing" }),
    ).resolves.toBe(false);
    expect(removeRuntimeResources).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });
});
