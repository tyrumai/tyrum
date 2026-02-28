import { describe, it, expect } from "vitest";
import { resolveHttpRouteRequiredScopes } from "../../src/modules/authz/http-scope-middleware.js";

describe("HTTP scope middleware route mapping", () => {
  it("maps read-only operator surfaces to operator.read", () => {
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/status" })).toEqual([
      "operator.read",
    ]);
    expect(
      resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/memory/exports/:id" }),
    ).toEqual(["operator.read"]);
  });

  it("maps write operator surfaces to operator.write", () => {
    expect(resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/watchers" })).toEqual([
      "operator.write",
    ]);
    expect(resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/workflow/run" })).toEqual([
      "operator.write",
    ]);
  });

  it("maps approval surfaces to operator.approvals", () => {
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/approvals" })).toEqual([
      "operator.approvals",
    ]);
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/approvals/:id/respond" }),
    ).toEqual(["operator.approvals"]);
  });

  it("maps pairing surfaces to operator.pairing", () => {
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/pairings" })).toEqual([
      "operator.pairing",
    ]);
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/pairings/:id/approve" }),
    ).toEqual(["operator.pairing"]);
  });

  it("maps tenant admin surfaces to operator.admin", () => {
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/auth/pins" })).toEqual([
      "operator.admin",
    ]);
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/auth/device-tokens/issue" }),
    ).toEqual(["operator.admin"]);
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/secrets" })).toEqual([
      "operator.admin",
    ]);
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/snapshot/import" }),
    ).toEqual(["operator.admin"]);
    expect(
      resolveHttpRouteRequiredScopes({
        method: "POST",
        routePath: "/providers/:provider/oauth/authorize",
      }),
    ).toEqual(["operator.admin"]);
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/routing/config" })).toEqual(
      ["operator.admin"],
    );
    expect(resolveHttpRouteRequiredScopes({ method: "PUT", routePath: "/routing/config" })).toEqual(
      ["operator.admin"],
    );
  });

  it("does not map removed /app and /api compatibility routes", () => {
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/app/actions/approvals/:id" }),
    ).toBeNull();
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/app/actions/linking/:slug" }),
    ).toBeNull();
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/app/actions/account/delete" }),
    ).toBeNull();
    expect(
      resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/api/account/delete" }),
    ).toBeNull();
  });

  it("denies unknown routes by default", () => {
    expect(resolveHttpRouteRequiredScopes({ method: "GET", routePath: "/unmapped" })).toBeNull();
    expect(resolveHttpRouteRequiredScopes({ method: "POST", routePath: "/unmapped" })).toBeNull();
  });
});
