// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  arrangeBootstrap,
  getRenderedOperatorUiProps,
  jsonResponse,
  resetWebMainTestState,
} from "./main.test-support.js";

describe("apps/web main auth persistence failures", { timeout: 15_000 }, () => {
  beforeEach(() => {
    resetWebMainTestState();
  });

  it("surfaces plain-text saveToken failures from browser conversation bootstrap", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthCookie).mockResolvedValue(
      new Response("gateway unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.saveToken("broken-token")).rejects.toThrow(
      "gateway unavailable",
    );
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
    expect(localStorage.getItem("tyrum-operator-token")).toBeNull();
  });

  it("keeps the saved token when logout fails", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.clearGatewayAuthCookie).mockResolvedValue(
      jsonResponse(503, {
        error: "service_unavailable",
        message: "Authentication service is unavailable; please try again later.",
      }),
    );
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.clearToken()).rejects.toThrow(
      "Authentication service is unavailable; please try again later.",
    );
    expect(removeItemSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem("tyrum-operator-token")).toBe("stored-token");
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });

  it("uses the status-based fallback message when content-type header is missing", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthCookie).mockResolvedValue(
      new Response("", { status: 500 }),
    );

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.saveToken("some-token")).rejects.toThrow(
      "Failed to create a browser auth cookie (HTTP 500).",
    );
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });

  it("falls back to the status message when JSON body.message is not a string", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthCookie).mockResolvedValue(
      new Response(JSON.stringify({ error: "bad_request", message: 42 }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.saveToken("some-token")).rejects.toThrow(
      "Failed to create a browser auth cookie (HTTP 400).",
    );
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });

  it("falls back to the status message when body parsing throws", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthCookie).mockResolvedValue(
      new Response("not valid json", {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.saveToken("some-token")).rejects.toThrow(
      "Failed to create a browser auth cookie (HTTP 422).",
    );
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });

  it("skips restoring the browser conversation on clearToken failure when no token was saved", async () => {
    const { operatorCore, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    vi.mocked(operatorCore.createGatewayAuthCookie).mockClear();
    vi.mocked(operatorCore.clearGatewayAuthCookie).mockClear();

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.clearToken()).rejects.toThrow("storage unavailable");

    expect(operatorCore.createGatewayAuthCookie).not.toHaveBeenCalled();
  });

  it("restores the browser conversation when token removal fails during logout", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await import("../src/main.tsx");

    vi.mocked(operatorCore.createGatewayAuthCookie).mockClear();
    vi.mocked(operatorCore.clearGatewayAuthCookie).mockClear();

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.clearToken()).rejects.toThrow("storage unavailable");

    expect(removeItemSpy).toHaveBeenCalledWith("tyrum-operator-token");
    expect(operatorCore.clearGatewayAuthCookie).toHaveBeenCalledWith({
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(operatorCore.createGatewayAuthCookie).toHaveBeenCalledWith({
      token: "stored-token",
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(localStorage.getItem("tyrum-operator-token")).toBe("stored-token");
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });
});
