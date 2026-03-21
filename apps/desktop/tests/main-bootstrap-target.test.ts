import { pathToFileURL } from "node:url";
import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBootstrapTarget } from "../src/main/bootstrap-target.js";

function absolutePath(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return process.platform === "win32"
    ? win32.join("C:\\", ...segments)
    : posix.join("/", ...segments);
}

function absoluteFileUrl(path: string): string {
  return pathToFileURL(absolutePath(path)).href;
}

describe("resolveBootstrapTarget", () => {
  it("starts the desktop app when not running under Electron-as-Node", () => {
    expect(
      resolveBootstrapTarget({
        env: {},
        argv: [absolutePath("/Applications/Tyrum.app/Contents/MacOS/Tyrum")],
        bootstrapModuleUrl: absoluteFileUrl("/repo/apps/desktop/src/main/bootstrap-target.ts"),
      }),
    ).toEqual({ kind: "app" });
  });

  it("delegates to the requested script when Electron-as-Node passes a child entrypoint", () => {
    const packagedScriptPath = absolutePath(
      "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway/index.mjs",
    );

    expect(
      resolveBootstrapTarget({
        env: { ELECTRON_RUN_AS_NODE: "1" },
        argv: [
          absolutePath("/Applications/Tyrum.app/Contents/MacOS/Tyrum"),
          packagedScriptPath,
          "start",
        ],
        bootstrapModuleUrl: absoluteFileUrl("/repo/apps/desktop/src/main/bootstrap.ts"),
      }),
    ).toEqual({
      kind: "delegate",
      scriptPath: packagedScriptPath,
    });
  });

  it("does not recurse when Electron-as-Node points back at the bootstrap entrypoint", () => {
    const bootstrapScriptPath = absolutePath("/repo/apps/desktop/src/main/bootstrap.ts");

    expect(
      resolveBootstrapTarget({
        env: { ELECTRON_RUN_AS_NODE: "1" },
        argv: [absolutePath("/Applications/Tyrum.app/Contents/MacOS/Tyrum"), bootstrapScriptPath],
        bootstrapModuleUrl: absoluteFileUrl("/repo/apps/desktop/src/main/bootstrap.ts"),
      }),
    ).toEqual({ kind: "app" });
  });
});
