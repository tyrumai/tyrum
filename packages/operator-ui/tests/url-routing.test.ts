import { describe, expect, it } from "vitest";
import { buildRoutePath, isRouteValidForHost, parseRoute } from "../src/url-routing.js";

describe("parseRoute()", () => {
  it("parses a valid route", () => {
    expect(parseRoute("/ui/dashboard", "")).toEqual({ routeId: "dashboard" });
  });

  it("parses all standard sidebar routes", () => {
    for (const id of [
      "dashboard",
      "chat",
      "approvals",
      "workboard",
      "agents",
      "extensions",
      "memory",
      "schedules",
      "pairing",
      "desktop-environments",
      "configure",
    ]) {
      expect(parseRoute(`/ui/${id}`, "")).toEqual({ routeId: id });
    }
  });

  it("parses platform routes", () => {
    expect(parseRoute("/ui/desktop", "")).toEqual({ routeId: "desktop" });
    expect(parseRoute("/ui/browser", "")).toEqual({ routeId: "browser" });
    expect(parseRoute("/ui/mobile", "")).toEqual({ routeId: "mobile" });
  });

  it("parses configure with tab query param", () => {
    expect(parseRoute("/ui/configure", "?tab=providers")).toEqual({
      routeId: "configure",
      tab: "providers",
    });
  });

  it("omits tab for configure when tab is general (default)", () => {
    expect(parseRoute("/ui/configure", "?tab=general")).toEqual({
      routeId: "configure",
    });
  });

  it("returns null for bare /ui/", () => {
    expect(parseRoute("/ui/", "")).toBeNull();
  });

  it("returns null for unknown route", () => {
    expect(parseRoute("/ui/unknown-page", "")).toBeNull();
  });

  it("returns null for path without /ui/ prefix", () => {
    expect(parseRoute("/dashboard", "")).toBeNull();
  });

  it("strips trailing slashes", () => {
    expect(parseRoute("/ui/chat/", "")).toEqual({ routeId: "chat" });
    expect(parseRoute("/ui/chat///", "")).toEqual({ routeId: "chat" });
  });

  it("ignores tab param for non-configure routes", () => {
    expect(parseRoute("/ui/dashboard", "?tab=providers")).toEqual({
      routeId: "dashboard",
    });
  });
});

describe("buildRoutePath()", () => {
  it("builds path for standard routes", () => {
    expect(buildRoutePath("dashboard")).toBe("/ui/dashboard");
    expect(buildRoutePath("chat")).toBe("/ui/chat");
    expect(buildRoutePath("approvals")).toBe("/ui/approvals");
    expect(buildRoutePath("desktop-environments")).toBe("/ui/desktop-environments");
  });

  it("builds configure path without tab", () => {
    expect(buildRoutePath("configure")).toBe("/ui/configure");
  });

  it("builds configure path with tab", () => {
    expect(buildRoutePath("configure", "providers")).toBe("/ui/configure?tab=providers");
  });

  it("omits default general tab from configure URL", () => {
    expect(buildRoutePath("configure", "general")).toBe("/ui/configure");
  });

  it("ignores tab for non-configure routes", () => {
    expect(buildRoutePath("dashboard", "providers")).toBe("/ui/dashboard");
  });
});

describe("isRouteValidForHost()", () => {
  it("accepts shared routes for web", () => {
    expect(isRouteValidForHost("dashboard", "web")).toBe(true);
    expect(isRouteValidForHost("configure", "web")).toBe(true);
  });

  it("rejects desktop-only route for web", () => {
    expect(isRouteValidForHost("desktop", "web")).toBe(false);
  });

  it("accepts desktop route for desktop host", () => {
    expect(isRouteValidForHost("desktop", "desktop")).toBe(true);
  });

  it("rejects browser route for desktop host", () => {
    expect(isRouteValidForHost("browser", "desktop")).toBe(false);
  });

  it("accepts mobile route for mobile host", () => {
    expect(isRouteValidForHost("mobile", "mobile")).toBe(true);
  });
});
