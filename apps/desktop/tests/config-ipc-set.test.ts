import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/main/config/schema.js";

const { ipcMainHandleMock, registeredHandlers, loadConfigMock, saveConfigMock } = vi.hoisted(
  () => ({
    ipcMainHandleMock: vi.fn(),
    registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    loadConfigMock: vi.fn(),
    saveConfigMock: vi.fn(),
  }),
);

vi.mock("electron", () => ({
  ipcMain: { handle: ipcMainHandleMock },
  nativeTheme: { themeSource: "system" },
  shell: { openExternal: vi.fn() },
}));

vi.mock("../src/main/config/store.js", () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
}));

describe("config-ipc config:set allowlist", () => {
  beforeEach(() => {
    vi.resetModules();
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
    loadConfigMock.mockReturnValue(DEFAULT_CONFIG);
    saveConfigMock.mockReset();
  });

  it("allows remote.tlsCertFingerprint256 via config:set", async () => {
    const { registerConfigIpc } = await import("../src/main/ipc/config-ipc.js");
    registerConfigIpc();

    const handler = registeredHandlers.get("config:set");
    expect(handler).toBeTypeOf("function");

    const result = handler?.({}, { remote: { tlsCertFingerprint256: "AA:BB" } });

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remote: expect.objectContaining({ tlsCertFingerprint256: "AA:BB" }),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        remote: expect.objectContaining({ tlsCertFingerprint256: "AA:BB" }),
      }),
    );
  });

  it("allows theme.source via config:set and updates nativeTheme.themeSource", async () => {
    const { registerConfigIpc } = await import("../src/main/ipc/config-ipc.js");
    registerConfigIpc();

    const handler = registeredHandlers.get("config:set");
    expect(handler).toBeTypeOf("function");

    const { nativeTheme } = await import("electron");
    expect(nativeTheme.themeSource).toBe("system");

    const result = handler?.({}, { theme: { source: "light" } });

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({ source: "light" }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        theme: expect.objectContaining({ source: "light" }),
      }),
    );
    expect(nativeTheme.themeSource).toBe("light");
  });
});
