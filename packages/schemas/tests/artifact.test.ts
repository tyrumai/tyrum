import { describe, expect, it } from "vitest";
import { ArtifactKind, ArtifactRef } from "../src/index.js";

describe("ArtifactKind", () => {
  it("accepts known kinds", () => {
    expect(ArtifactKind.parse("screenshot")).toBe("screenshot");
    expect(ArtifactKind.parse("diff")).toBe("diff");
    expect(ArtifactKind.parse("log")).toBe("log");
  });
});

describe("ArtifactRef", () => {
  it("parses an artifact reference", () => {
    const ref = ArtifactRef.parse({
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      kind: "screenshot",
      created_at: "2026-02-19T12:00:00Z",
      mime_type: "image/png",
      size_bytes: 123,
      sha256: "a".repeat(64),
      labels: ["evidence", "ui"],
    });

    expect(ref.kind).toBe("screenshot");
    expect(ref.uri).toContain("artifact://");
  });
});

