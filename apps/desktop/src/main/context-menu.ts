import type { MenuItemConstructorOptions } from "electron";
import { isSafeExternalUrl } from "./safe-external-url.js";

export type ContextMenuEditFlags = {
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canSelectAll?: boolean;
};

export type ContextMenuParamsLike = {
  isEditable?: boolean;
  linkURL?: string;
  editFlags?: ContextMenuEditFlags;
  x?: number;
  y?: number;
};

export type ContextMenuBuilderDeps = {
  onOpenLinkInBrowser: (url: string) => void;
};

export function buildContextMenuTemplate(
  params: ContextMenuParamsLike,
  deps: ContextMenuBuilderDeps,
): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    const editFlags = params.editFlags ?? {};
    return [
      { role: "cut", enabled: editFlags.canCut ?? true },
      { role: "copy", enabled: editFlags.canCopy ?? true },
      { role: "paste", enabled: editFlags.canPaste ?? true },
      { role: "selectAll", enabled: editFlags.canSelectAll ?? true },
    ];
  }

  const linkUrl = params.linkURL;
  if (linkUrl && isSafeExternalUrl(linkUrl)) {
    return [
      {
        label: "Open Link in Browser",
        click: () => {
          deps.onOpenLinkInBrowser(linkUrl);
        },
      },
    ];
  }

  return [];
}

export function registerContextMenus(deps: {
  app: Pick<typeof import("electron").app, "on">;
  BrowserWindow: Pick<typeof import("electron").BrowserWindow, "fromWebContents">;
  Menu: Pick<typeof import("electron").Menu, "buildFromTemplate">;
  shell: Pick<typeof import("electron").shell, "openExternal">;
}): void {
  deps.app.on("web-contents-created", (_event, contents) => {
    contents.on("context-menu", (_event, params) => {
      const template = buildContextMenuTemplate(params, {
        onOpenLinkInBrowser: (url) => {
          void deps.shell.openExternal(url);
        },
      });

      if (template.length === 0) {
        return;
      }

      const menu = deps.Menu.buildFromTemplate(template);
      const window = deps.BrowserWindow.fromWebContents(contents) ?? undefined;
      menu.popup({ window, x: params.x, y: params.y });
    });
  });
}
