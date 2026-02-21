import { describe, expect, it } from "vitest";
import { ArtifactMetadata } from "../src/index.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = "2026-02-20T10:00:00Z";

describe("ArtifactMetadata", () => {
  const valid = {
    artifact_id: UUID,
    kind: "screenshot" as const,
    uri: `artifact://${UUID}`,
    created_at: NOW,
  };

  it("parses a minimal valid metadata", () => {
    const m = ArtifactMetadata.parse(valid);
    expect(m.artifact_id).toBe(UUID);
    expect(m.kind).toBe("screenshot");
    expect(m.labels).toEqual([]);
  });

  it("parses a full metadata", () => {
    const m = ArtifactMetadata.parse({
      ...valid,
      run_id: UUID,
      step_id: UUID,
      attempt_id: UUID,
      mime_type: "image/png",
      size_bytes: 4096,
      sha256: "a".repeat(64),
      labels: ["evidence"],
      metadata: { source: "browser" },
    });
    expect(m.size_bytes).toBe(4096);
    expect(m.labels).toEqual(["evidence"]);
  });

  it("rejects missing artifact_id", () => {
    const { artifact_id: _, ...bad } = valid;
    expect(() => ArtifactMetadata.parse(bad)).toThrow();
  });

  it("rejects invalid artifact uri", () => {
    expect(() =>
      ArtifactMetadata.parse({ ...valid, uri: "https://bad" }),
    ).toThrow();
  });

  it("rejects negative size_bytes", () => {
    expect(() =>
      ArtifactMetadata.parse({ ...valid, size_bytes: -1 }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      ArtifactMetadata.parse({ ...valid, extra: true }),
    ).toThrow();
  });
});
