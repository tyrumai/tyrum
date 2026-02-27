import { beforeEach, describe, expect, it, vi } from "vitest";

const { exposeInMainWorldMock } = vi.hoisted(() => {
  return {
    exposeInMainWorldMock: vi.fn(),
  };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    invoke: vi.fn(async () => null),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

describe("desktop preload deep links", () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorldMock.mockClear();
  });

  it("exposes deep link APIs on window.tyrumDesktop", async () => {
    await import("../src/preload/index.js");

    expect(exposeInMainWorldMock).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorldMock).toHaveBeenCalledWith(
      "tyrumDesktop",
      expect.objectContaining({
        consumeDeepLink: expect.any(Function),
        onDeepLinkOpen: expect.any(Function),
      }),
    );
  });
});

