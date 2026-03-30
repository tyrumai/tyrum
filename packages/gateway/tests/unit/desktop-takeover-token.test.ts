import { describe, expect, it } from "vitest";
import {
  buildDesktopTakeoverEntryUrl,
  ensureDesktopTakeoverEntrySearch,
} from "../../src/modules/desktop-environments/takeover-token.js";

describe("desktop takeover token helpers", () => {
  it("forces autoconnect and the token-scoped websockify path while preserving unrelated params", () => {
    const search = ensureDesktopTakeoverEntrySearch("?resize=remote&autoconnect=false&path=wrong", "token-1");
    const params = new URLSearchParams(search);

    expect(params.get("resize")).toBe("remote");
    expect(params.get("autoconnect")).toBe("true");
    expect(params.get("path")).toBe("desktop-takeover/s/token-1/websockify");
  });

  it("builds entry urls with the canonical noVNC query parameters", () => {
    const entryUrl = new URL(buildDesktopTakeoverEntryUrl("https://gateway.example/base/", "token-1"));

    expect(entryUrl.pathname).toBe("/desktop-takeover/s/token-1/vnc.html");
    expect(entryUrl.searchParams.get("autoconnect")).toBe("true");
    expect(entryUrl.searchParams.get("path")).toBe("desktop-takeover/s/token-1/websockify");
  });
});
