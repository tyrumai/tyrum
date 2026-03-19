import { describe, expect, it } from "vitest";
import { ArtifactKind, ArtifactRef } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("ArtifactKind", () => {
  it("accepts known kinds", () => {
    expect(ArtifactKind.parse("screenshot")).toBe("screenshot");
    expect(ArtifactKind.parse("diff")).toBe("diff");
    expect(ArtifactKind.parse("log")).toBe("log");
  });

  it("rejects unknown kinds", () => {
    expectRejects(ArtifactKind, "unknown");
  });
});

describe("ArtifactRef", () => {
  const baseRef = {
    artifact_id: "550e8400-e29b-41d4-a716-446655440000",
    uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
    external_url: "https://gateway.example.test/a/550e8400-e29b-41d4-a716-446655440000",
    kind: "screenshot",
    media_class: "image",
    created_at: "2026-02-19T12:00:00Z",
    filename: "550e8400-e29b-41d4-a716-446655440000.png",
    mime_type: "image/png",
    size_bytes: 123,
    sha256: "a".repeat(64),
    labels: ["evidence", "ui"],
  } as const;

  it("parses an artifact reference", () => {
    const ref = ArtifactRef.parse(baseRef);

    expect(ref.kind).toBe("screenshot");
    expect(ref.uri).toContain("artifact://");
  });

  it("rejects an artifact reference missing uri", () => {
    const bad = { ...baseRef } as Record<string, unknown>;
    delete bad.uri;
    expectRejects(ArtifactRef, bad);
  });

  it("rejects an artifact reference missing external_url", () => {
    const bad = { ...baseRef } as Record<string, unknown>;
    delete bad.external_url;
    expectRejects(ArtifactRef, bad);
  });

  it("rejects an artifact reference with wrong sha256 type", () => {
    expectRejects(ArtifactRef, { ...baseRef, sha256: 123 });
  });
});
