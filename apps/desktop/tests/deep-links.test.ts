import { describe, expect, it } from "vitest";

import { extractDeepLinkUrlFromArgv } from "../src/main/deep-links.js";

describe("desktop deep link argv parsing", () => {
  it("returns null when argv does not include a tyrum:// URL", () => {
    expect(extractDeepLinkUrlFromArgv(["electron", "--foo", "bar"])).toBeNull();
  });

  it("returns the first tyrum:// URL in argv", () => {
    expect(
      extractDeepLinkUrlFromArgv(["electron", "tyrum://open?x=1", "tyrum://second?y=2"]),
    ).toBe("tyrum://open?x=1");
  });

  it("ignores malformed tyrum:// URL values", () => {
    expect(extractDeepLinkUrlFromArgv(["electron", "tyrum://bad url"])).toBeNull();
  });
});

