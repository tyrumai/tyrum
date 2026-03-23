import { describe, expect, it } from "vitest";
import { isDesktopInventoryLoading } from "../../src/components/pages/desktop-environments-page.loading.js";

describe("isDesktopInventoryLoading", () => {
  it("returns true before the current admin client has loaded inventory", () => {
    const currentClient = { id: "admin-http-1" };

    expect(
      isDesktopInventoryLoading({
        currentClient,
        loading: false,
        loadedForClient: null,
      }),
    ).toBe(true);
  });

  it("returns false once inventory has loaded for the current admin client", () => {
    const currentClient = { id: "admin-http-1" };

    expect(
      isDesktopInventoryLoading({
        currentClient,
        loading: false,
        loadedForClient: currentClient,
      }),
    ).toBe(false);
  });

  it("returns true again when the admin client changes", () => {
    const previousClient = { id: "admin-http-1" };
    const currentClient = { id: "admin-http-2" };

    expect(
      isDesktopInventoryLoading({
        currentClient,
        loading: false,
        loadedForClient: previousClient,
      }),
    ).toBe(true);
  });

  it("returns false when admin access is unavailable", () => {
    expect(
      isDesktopInventoryLoading({
        currentClient: null,
        loading: false,
        loadedForClient: { id: "admin-http-1" },
      }),
    ).toBe(false);
  });

  it("returns true while a refresh is in flight for the current client", () => {
    const currentClient = { id: "admin-http-1" };

    expect(
      isDesktopInventoryLoading({
        currentClient,
        loading: true,
        loadedForClient: currentClient,
      }),
    ).toBe(true);
  });
});
