import { describe, it, expect } from "vitest";
import { matchesWildcard, wildcardToRegex } from "../../src/modules/policy/wildcard.js";

describe("matchesWildcard", () => {
  it("matches exact strings", () => {
    expect(matchesWildcard("foo.bar", "foo.bar")).toBe(true);
    expect(matchesWildcard("foo.bar", "foo.baz")).toBe(false);
  });

  it("* matches zero or more characters", () => {
    expect(matchesWildcard("foo.*", "foo.bar")).toBe(true);
    expect(matchesWildcard("foo.*", "foo.")).toBe(true);
    expect(matchesWildcard("foo.*", "foo.bar.baz")).toBe(true);
    expect(matchesWildcard("*", "anything")).toBe(true);
    expect(matchesWildcard("*", "")).toBe(true);
  });

  it("? matches exactly one character", () => {
    expect(matchesWildcard("foo.?ar", "foo.bar")).toBe(true);
    expect(matchesWildcard("foo.?ar", "foo.car")).toBe(true);
    expect(matchesWildcard("foo.?ar", "foo.ar")).toBe(false);
    expect(matchesWildcard("foo.?ar", "foo.baar")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    expect(matchesWildcard("foo.bar", "foo.bar")).toBe(true);
    expect(matchesWildcard("foo.bar", "fooXbar")).toBe(false);
    expect(matchesWildcard("a+b", "a+b")).toBe(true);
    expect(matchesWildcard("a+b", "aab")).toBe(false);
  });

  it("handles combined wildcards", () => {
    expect(matchesWildcard("*/run_?", "workspace/run_1")).toBe(true);
    expect(matchesWildcard("*/run_?", "workspace/run_12")).toBe(false);
  });
});

describe("wildcardToRegex", () => {
  it("produces a full-match regex", () => {
    const re = wildcardToRegex("foo");
    expect(re.test("foo")).toBe(true);
    expect(re.test("foobar")).toBe(false);
    expect(re.test("afoo")).toBe(false);
  });
});
