import { describe, expect, it, vi } from "vitest";

let sessionBus: {
  getProxyObject: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
let atspiBus: {
  getProxyObject: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

vi.mock("dbus-next", () => ({
  sessionBus: (options?: { busAddress?: string }) => {
    if (options?.busAddress) return atspiBus;
    return sessionBus;
  },
}));

import { AtSpiDesktopA11yBackend } from "../src/providers/backends/atspi-a11y-backend.js";

describe("AtSpiDesktopA11yBackend connect()", () => {
  it("disconnects the AT-SPI bus on partial connection failures", async () => {
    sessionBus = {
      getProxyObject: vi.fn(async () => ({
        getInterface: vi.fn(() => ({
          GetAddress: vi.fn(async () => "unix:path=/tmp/atspi-bus"),
        })),
      })),
      disconnect: vi.fn(),
    };

    atspiBus = {
      getProxyObject: vi.fn(async () => {
        throw new Error("boom");
      }),
      disconnect: vi.fn(),
    };

    const backend = new AtSpiDesktopA11yBackend();
    await expect(backend.isAvailable()).resolves.toBe(false);

    expect(sessionBus.disconnect).toHaveBeenCalledTimes(1);
    expect(atspiBus.disconnect).toHaveBeenCalledTimes(1);
  });
});

