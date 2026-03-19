// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTyrumHttpFetch } from "../../src/utils/tyrum-http-fetch.js";
import type { DesktopApi } from "../../src/desktop-api.js";

describe("resolveTyrumHttpFetch", () => {
  afterEach(() => {
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("returns undefined outside desktop mode", () => {
    expect(resolveTyrumHttpFetch(null, "web")).toBeUndefined();
  });

  it("returns undefined when the desktop api is unavailable", () => {
    expect(resolveTyrumHttpFetch(null, "desktop")).toBeUndefined();
  });

  it("returns undefined when the desktop api has no gateway httpFetch", () => {
    expect(resolveTyrumHttpFetch({ gateway: {} } as DesktopApi, "desktop")).toBeUndefined();
  });

  it("adapts desktop gateway httpFetch and rejects non-string request bodies", async () => {
    const httpFetch = vi.fn().mockResolvedValue({
      status: 201,
      headers: { "x-test": "1" },
      bodyText: "ok",
    });
    const fetch = resolveTyrumHttpFetch({ gateway: { httpFetch } } as DesktopApi, "desktop");
    expect(fetch).toBeDefined();

    const res = await fetch?.("https://example.com/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });

    expect(httpFetch).toHaveBeenCalledWith({
      url: "https://example.com/test",
      init: {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello",
      },
    });
    expect(res?.status).toBe(201);
    expect(res?.headers.get("x-test")).toBe("1");
    await expect(res?.text()).resolves.toBe("ok");

    await fetch?.(new URL("https://example.com/other"));
    expect(httpFetch).toHaveBeenCalledWith({
      url: "https://example.com/other",
      init: { method: undefined, headers: undefined, body: undefined },
    });

    await fetch?.(new Request("https://example.com/request"), { body: null });
    expect(httpFetch).toHaveBeenCalledWith({
      url: "https://example.com/request",
      init: { method: undefined, headers: undefined, body: undefined },
    });

    await expect(
      fetch?.("https://example.com/bad", { method: "POST", body: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/only supports string request bodies/i);
  });
});
