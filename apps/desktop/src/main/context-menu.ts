import type { MenuItemConstructorOptions } from "electron";

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

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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

type ElectronApp = {
  on: (
    event: "web-contents-created",
    listener: (event: unknown, contents: WebContentsLike) => void,
  ) => void;
};

type WebContentsLike = {
  on: (
    event: "context-menu",
    listener: (event: unknown, params: ContextMenuParamsLike) => void,
  ) => void;
};

type MenuInstanceLike = {
  popup: (options: { window?: unknown; x?: number; y?: number }) => void;
};

type MenuLike = {
  buildFromTemplate: (template: MenuItemConstructorOptions[]) => MenuInstanceLike;
};

type BrowserWindowLike = {
  fromWebContents: (contents: WebContentsLike) => unknown | null;
};

type ShellLike = {
  openExternal: (url: string) => unknown;
};

export function registerContextMenus(deps: {
  app: ElectronApp;
  BrowserWindow: BrowserWindowLike;
  Menu: MenuLike;
  shell: ShellLike;
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
