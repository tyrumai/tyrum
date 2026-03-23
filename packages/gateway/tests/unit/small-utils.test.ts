/**
 * Small utility modules — batch unit tests for lightweight helpers.
 *
 * Tests the branch paths in:
 * - utils/sql-like.ts (escapeLikePattern)
 * - utils/sql.ts (buildSqlPlaceholders)
 * - execution/normalize-positive-int.ts
 * - observability/request-id.ts
 * - artifact/evidence-sensitivity.ts
 */

import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "../../src/utils/sql-like.js";
import { buildSqlPlaceholders } from "../../src/utils/sql.js";
import { normalizePositiveInt } from "../../src/modules/execution/normalize-positive-int.js";
import { requestIdForAudit } from "../../src/modules/observability/request-id.js";
import { parseEvidenceSensitivity } from "../../src/modules/artifact/evidence-sensitivity.js";

describe("escapeLikePattern", () => {
  it("escapes backslashes", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapes percent signs", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
  });

  it("escapes underscores", () => {
    expect(escapeLikePattern("my_table")).toBe("my\\_table");
  });

  it("returns unchanged string when no special characters", () => {
    expect(escapeLikePattern("normal")).toBe("normal");
  });

  it("handles all special characters together", () => {
    expect(escapeLikePattern("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });
});

describe("buildSqlPlaceholders", () => {
  it("returns single placeholder for count 1", () => {
    expect(buildSqlPlaceholders(1)).toBe("?");
  });

  it("returns comma-separated placeholders for count 3", () => {
    expect(buildSqlPlaceholders(3)).toBe("?, ?, ?");
  });

  it("returns empty string for count 0", () => {
    expect(buildSqlPlaceholders(0)).toBe("");
  });
});

describe("normalizePositiveInt", () => {
  it("returns the floored value for a positive number", () => {
    expect(normalizePositiveInt(5.7)).toBe(5);
  });

  it("returns undefined for zero", () => {
    expect(normalizePositiveInt(0)).toBeUndefined();
  });

  it("returns undefined for negative numbers", () => {
    expect(normalizePositiveInt(-3)).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(normalizePositiveInt(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(normalizePositiveInt(Infinity)).toBeUndefined();
  });

  it("returns undefined for non-number types", () => {
    expect(normalizePositiveInt("5")).toBeUndefined();
    expect(normalizePositiveInt(null)).toBeUndefined();
    expect(normalizePositiveInt(undefined)).toBeUndefined();
  });

  it("returns 1 for 1", () => {
    expect(normalizePositiveInt(1)).toBe(1);
  });
});

describe("requestIdForAudit", () => {
  it("extracts request ID from request header", () => {
    const c = {
      req: { header: (name: string) => (name === "x-request-id" ? "req-123" : undefined) },
      res: { headers: { get: () => null } },
    };
    expect(requestIdForAudit(c)).toBe("req-123");
  });

  it("falls back to response header when request header is absent", () => {
    const c = {
      req: { header: () => undefined },
      res: { headers: { get: (name: string) => (name === "x-request-id" ? "res-456" : null) } },
    };
    expect(requestIdForAudit(c)).toBe("res-456");
  });

  it("returns undefined when neither header is present", () => {
    const c = {
      req: { header: () => undefined },
      res: { headers: { get: () => null } },
    };
    expect(requestIdForAudit(c)).toBeUndefined();
  });

  it("trims whitespace from request header", () => {
    const c = {
      req: { header: () => "  req-789  " },
      res: { headers: { get: () => null } },
    };
    expect(requestIdForAudit(c)).toBe("req-789");
  });

  it("returns undefined for whitespace-only request header", () => {
    const c = {
      req: { header: () => "   " },
      res: { headers: { get: () => null } },
    };
    expect(requestIdForAudit(c)).toBeUndefined();
  });
});

describe("parseEvidenceSensitivity", () => {
  it("returns 'normal' for 'normal' input", () => {
    expect(parseEvidenceSensitivity("normal", "sensitive")).toBe("normal");
  });

  it("returns 'sensitive' for 'sensitive' input", () => {
    expect(parseEvidenceSensitivity("sensitive", "normal")).toBe("sensitive");
  });

  it("handles case-insensitive input", () => {
    expect(parseEvidenceSensitivity("NORMAL", "sensitive")).toBe("normal");
    expect(parseEvidenceSensitivity("SENSITIVE", "normal")).toBe("sensitive");
  });

  it("trims whitespace", () => {
    expect(parseEvidenceSensitivity("  normal  ", "sensitive")).toBe("normal");
  });

  it("returns fallback for undefined input", () => {
    expect(parseEvidenceSensitivity(undefined, "normal")).toBe("normal");
  });

  it("returns fallback for unrecognized input", () => {
    expect(parseEvidenceSensitivity("unknown", "sensitive")).toBe("sensitive");
  });

  it("returns fallback for empty string", () => {
    expect(parseEvidenceSensitivity("", "normal")).toBe("normal");
  });
});
