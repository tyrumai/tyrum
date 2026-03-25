import { describe, expect, it, vi } from "vitest";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";

async function createTakeoverEntry() {
  const { app, container, requestUnauthenticated } = await createTestApp();
  const hostDal = new DesktopEnvironmentHostDal(container.db);
  const environmentDal = new DesktopEnvironmentDal(container.db);

  await hostDal.upsert({
    hostId: "host-1",
    label: "Primary runtime",
    version: "0.1.0",
    dockerAvailable: true,
    healthy: true,
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    lastError: null,
  });

  const environment = await environmentDal.create({
    tenantId: DEFAULT_TENANT_ID,
    hostId: "host-1",
    label: "Research desktop",
    imageRef: "registry.example.test/desktop:latest",
    desiredRunning: true,
  });

  await environmentDal.updateRuntime({
    tenantId: DEFAULT_TENANT_ID,
    environmentId: environment.environment_id,
    status: "running",
    nodeId: "node-desktop-1",
    takeoverUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
    logs: ["desktop runtime ready"],
    lastError: null,
  });

  const createSessionRes = await app.request(
    `/desktop-environments/${environment.environment_id}/takeover-session`,
    {
      method: "POST",
    },
  );
  expect(createSessionRes.status).toBe(200);
  const createSessionBody = (await createSessionRes.json()) as {
    session: { entry_url: string };
  };

  return {
    entryUrl: new URL(createSessionBody.session.entry_url),
    requestUnauthenticated,
  };
}

describe("desktop takeover http proxy", () => {
  it("redirects entry requests back to the canonical autoconnect url", async () => {
    const { entryUrl, requestUnauthenticated } = await createTakeoverEntry();
    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.fn<typeof fetch>();
    globalThis.fetch = upstreamFetch;
    try {
      const res = await requestUnauthenticated(entryUrl.pathname, {
        redirect: "manual",
      });

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`${entryUrl.pathname}${entryUrl.search}`);
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("strips sensitive headers on the upstream request and set-cookie on the response", async () => {
    const { entryUrl, requestUnauthenticated } = await createTakeoverEntry();
    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:6080/vnc.html?autoconnect=true");
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("origin")).toBe(false);
      expect(headers.has("referer")).toBe(false);

      return new Response("<html>proxied desktop</html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "desktop=1; HttpOnly",
        },
      });
    });
    globalThis.fetch = upstreamFetch;
    try {
      const res = await requestUnauthenticated(`${entryUrl.pathname}${entryUrl.search}`, {
        headers: {
          authorization: "Bearer leaked-token",
          cookie: "session=secret",
          origin: "http://127.0.0.1:8788",
          referer: `http://127.0.0.1:8788${entryUrl.pathname}${entryUrl.search}`,
        },
      });

      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe("<html>proxied desktop</html>");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects non-GET and non-HEAD desktop takeover HTTP methods", async () => {
    const { entryUrl, requestUnauthenticated } = await createTakeoverEntry();
    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.fn<typeof fetch>();
    globalThis.fetch = upstreamFetch;
    try {
      const res = await requestUnauthenticated(entryUrl.pathname, {
        method: "POST",
      });

      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      await expect(res.text()).resolves.toBe("desktop takeover method not allowed");
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks upstream redirects from leaking back to the client", async () => {
    const { entryUrl, requestUnauthenticated } = await createTakeoverEntry();
    const originalFetch = globalThis.fetch;
    const upstreamFetch = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1:6080/admin",
        },
      });
    });
    globalThis.fetch = upstreamFetch;
    try {
      const res = await requestUnauthenticated(`${entryUrl.pathname}${entryUrl.search}`, {
        redirect: "manual",
      });

      expect(res.status).toBe(502);
      await expect(res.text()).resolves.toBe("desktop takeover upstream unavailable");
      expect(res.headers.get("location")).toBeNull();
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
