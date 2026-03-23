/**
 * validation.ts — unit tests for plugin manifest validation helpers.
 */

import { describe, expect, it } from "vitest";
import {
  missingRequiredManifestFields,
  resolveSafeChildPath,
  REQUIRED_MANIFEST_FIELDS,
} from "../../src/modules/plugins/validation.js";

describe("missingRequiredManifestFields", () => {
  it("returns empty array when all required fields are present", () => {
    const manifest: Record<string, unknown> = {};
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      manifest[field] = "value";
    }
    expect(missingRequiredManifestFields(manifest)).toEqual([]);
  });

  it("returns missing fields when some are absent", () => {
    const manifest = { id: "test", name: "Test" };
    const missing = missingRequiredManifestFields(manifest);
    expect(missing).toContain("version");
    expect(missing).toContain("entry");
    expect(missing).toContain("contributes");
    expect(missing).toContain("permissions");
    expect(missing).toContain("config_schema");
    expect(missing).not.toContain("id");
    expect(missing).not.toContain("name");
  });

  it("returns all required fields when manifest is empty", () => {
    expect(missingRequiredManifestFields({})).toEqual([...REQUIRED_MANIFEST_FIELDS]);
  });
});

describe("resolveSafeChildPath", () => {
  it("resolves a valid child path within the parent", () => {
    const result = resolveSafeChildPath("/parent", "child/file.txt");
    expect(result).toContain("child/file.txt");
  });

  it("throws when child path escapes parent via ..", () => {
    expect(() => resolveSafeChildPath("/parent", "../escape")).toThrow(
      /path escapes plugin directory/,
    );
  });

  it("throws for deeply escaped paths", () => {
    expect(() => resolveSafeChildPath("/parent/sub", "../../escape")).toThrow(
      /path escapes plugin directory/,
    );
  });

  it("resolves a child path that is just the parent (empty relative)", () => {
    const result = resolveSafeChildPath("/parent", ".");
    expect(result).toBe("/parent");
  });
});
