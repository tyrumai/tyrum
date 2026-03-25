import { describe, expect, it } from "vitest";
import { resolveBetterSqliteNativeBindingPath } from "../../src/better-sqlite-native-binding.js";

describe("resolveBetterSqliteNativeBindingPath", () => {
  it("returns the unpacked native addon path for packaged POSIX bundles", () => {
    const moduleDir = "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway";
    const expected =
      "/Applications/Tyrum.app/Contents/Resources/app.asar.unpacked/dist/gateway/node_modules/better-sqlite3/build/Release/better_sqlite3.node";

    expect(
      resolveBetterSqliteNativeBindingPath({
        moduleDir,
        exists: (path) => path === expected,
      }),
    ).toBe(expected);
  });

  it("returns the unpacked native addon path for packaged Windows bundles", () => {
    const moduleDir = String.raw`D:\a\tyrum\tyrum\apps\desktop\release\win-unpacked\resources\app.asar\dist\gateway`;
    const expected = String.raw`D:\a\tyrum\tyrum\apps\desktop\release\win-unpacked\resources\app.asar.unpacked\dist\gateway\node_modules\better-sqlite3\build\Release\better_sqlite3.node`;

    expect(
      resolveBetterSqliteNativeBindingPath({
        moduleDir,
        exists: (path) => path === expected,
      }),
    ).toBe(expected);
  });

  it("returns undefined when the gateway is not running from a packaged asar bundle", () => {
    expect(
      resolveBetterSqliteNativeBindingPath({
        moduleDir: "/repo/packages/gateway/dist",
        exists: () => true,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the unpacked native addon is missing", () => {
    expect(
      resolveBetterSqliteNativeBindingPath({
        moduleDir: "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway",
        exists: () => false,
      }),
    ).toBeUndefined();
  });
});
