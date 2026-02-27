import { describe, expect, it, vi } from "vitest";
import { buildContextMenuTemplate, registerContextMenus } from "../src/main/context-menu.js";

describe("context menus", () => {
  describe("buildContextMenuTemplate", () => {
    it("shows Cut/Copy/Paste/Select All for editable targets", () => {
      const onOpenLinkInBrowser = vi.fn();

      const template = buildContextMenuTemplate(
        {
          isEditable: true,
          editFlags: { canCut: true, canCopy: true, canPaste: false, canSelectAll: true },
        },
        { onOpenLinkInBrowser },
      );

      expect(template).toEqual([
        { role: "cut", enabled: true },
        { role: "copy", enabled: true },
        { role: "paste", enabled: false },
        { role: "selectAll", enabled: true },
      ]);
      expect(onOpenLinkInBrowser).not.toHaveBeenCalled();
    });

    it("shows “Open Link in Browser” for safe link URLs", () => {
      const onOpenLinkInBrowser = vi.fn();

      const template = buildContextMenuTemplate(
        { linkURL: "https://example.com/docs" },
        { onOpenLinkInBrowser },
      );

      expect(template).toHaveLength(1);
      expect(template[0]?.label).toBe("Open Link in Browser");

      template[0]?.click?.({} as never, null as never, {} as never);
      expect(onOpenLinkInBrowser).toHaveBeenCalledWith("https://example.com/docs");
    });

    it("omits “Open Link in Browser” for non-http(s) link URLs", () => {
      const onOpenLinkInBrowser = vi.fn();

      const template = buildContextMenuTemplate(
        { linkURL: "file:///tmp/readme.txt" },
        { onOpenLinkInBrowser },
      );

      expect(template).toEqual([]);
      expect(onOpenLinkInBrowser).not.toHaveBeenCalled();
    });

    it("returns an empty template when no supported context applies", () => {
      const onOpenLinkInBrowser = vi.fn();

      const template = buildContextMenuTemplate({}, { onOpenLinkInBrowser });

      expect(template).toEqual([]);
    });
  });

  describe("registerContextMenus", () => {
    it("registers per-WebContents handlers and shows the resulting menu", () => {
      const appOn = vi.fn();
      const webContentsOn = vi.fn();

      let capturedTemplate: unknown = null;
      const menuPopup = vi.fn();
      const menuBuildFromTemplate = vi.fn((template: unknown) => {
        capturedTemplate = template;
        return { popup: menuPopup } as never;
      });

      const shellOpenExternal = vi.fn(async () => {});
      const fromWebContents = vi.fn(() => ({}));

      registerContextMenus({
        app: { on: appOn },
        BrowserWindow: { fromWebContents },
        Menu: { buildFromTemplate: menuBuildFromTemplate },
        shell: { openExternal: shellOpenExternal },
      });

      const webContentsCreatedHandler = appOn.mock.calls.find(
        (call) => call[0] === "web-contents-created",
      )?.[1] as ((event: unknown, contents: unknown) => void) | undefined;
      expect(webContentsCreatedHandler).toBeTypeOf("function");

      webContentsCreatedHandler?.({}, { on: webContentsOn });

      const contextMenuHandler = webContentsOn.mock.calls.find(
        (call) => call[0] === "context-menu",
      )?.[1] as ((event: unknown, params: unknown) => void) | undefined;
      expect(contextMenuHandler).toBeTypeOf("function");

      contextMenuHandler?.({}, { linkURL: "https://example.com", x: 11, y: 22 });

      expect(fromWebContents).toHaveBeenCalledTimes(1);
      expect(menuBuildFromTemplate).toHaveBeenCalledTimes(1);
      expect(menuPopup).toHaveBeenCalledWith({ window: expect.anything(), x: 11, y: 22 });

      const template = capturedTemplate as { label?: string; click?: () => void }[];
      const openLinkItem = template.find((item) => item.label === "Open Link in Browser");
      expect(openLinkItem).toBeDefined();
      openLinkItem?.click?.();
      expect(shellOpenExternal).toHaveBeenCalledWith("https://example.com");
    });

    it("does not show a menu when no template entries exist", () => {
      const appOn = vi.fn();
      const webContentsOn = vi.fn();

      const menuPopup = vi.fn();
      const menuBuildFromTemplate = vi.fn(() => ({ popup: menuPopup }) as never);

      registerContextMenus({
        app: { on: appOn },
        BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
        Menu: { buildFromTemplate: menuBuildFromTemplate },
        shell: { openExternal: vi.fn(async () => {}) },
      });

      const webContentsCreatedHandler = appOn.mock.calls.find(
        (call) => call[0] === "web-contents-created",
      )?.[1] as ((event: unknown, contents: unknown) => void) | undefined;
      expect(webContentsCreatedHandler).toBeTypeOf("function");

      webContentsCreatedHandler?.({}, { on: webContentsOn });

      const contextMenuHandler = webContentsOn.mock.calls.find(
        (call) => call[0] === "context-menu",
      )?.[1] as ((event: unknown, params: unknown) => void) | undefined;
      expect(contextMenuHandler).toBeTypeOf("function");

      contextMenuHandler?.({}, {});

      expect(menuBuildFromTemplate).not.toHaveBeenCalled();
      expect(menuPopup).not.toHaveBeenCalled();
    });
  });
});
