import { describe, expect, it } from "vitest";
import {
  ArtifactKind,
  ArtifactRef,
  artifactFilenameFromMetadata,
  artifactMediaClassFromMimeType,
} from "../src/index.js";
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

  it("defaults labels to an empty array", () => {
    const { labels: _labels, ...withoutLabels } = baseRef;
    const ref = ArtifactRef.parse(withoutLabels);

    expect(ref.labels).toEqual([]);
  });
});

describe("artifactMediaClassFromMimeType", () => {
  it.each([
    ["image/png", undefined, "image"],
    ["audio/mpeg", undefined, "audio"],
    ["video/mp4", undefined, "video"],
    ["application/pdf", undefined, "document"],
    ["text/plain", undefined, "document"],
    ["application/activity+json", undefined, "document"],
    ["application/custom+xml", undefined, "document"],
    [undefined, " notes.md ", "document"],
    ["application/octet-stream", " report.PDF ", "document"],
    ["application/octet-stream", "archive.bin", "other"],
    [undefined, undefined, "other"],
  ])("maps mime=%s filename=%s to %s", (mimeType, filename, expected) => {
    expect(artifactMediaClassFromMimeType(mimeType, filename)).toBe(expected);
  });
});

describe("artifactFilenameFromMetadata", () => {
  it("prefers an explicit trimmed filename", () => {
    expect(
      artifactFilenameFromMetadata({
        artifactId: "abc123",
        kind: "other",
        filename: " report.csv ",
        mimeType: "application/octet-stream",
      }),
    ).toBe("report.csv");
  });

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["audio/mpeg", "mp3"],
    ["audio/ogg", "ogg"],
    ["audio/wav", "wav"],
    ["video/mp4", "mp4"],
    ["application/pdf", "pdf"],
    ["application/json", "json"],
    ["application/xml", "xml"],
    ["text/plain", "txt"],
    ["text/markdown", "md"],
    ["text/html", "html"],
    ["text/csv", "csv"],
  ])("derives .%s-compatible filenames from mime %s", (mimeType, extension) => {
    expect(
      artifactFilenameFromMetadata({
        artifactId: "artifact-123",
        kind: "other",
        mimeType,
      }),
    ).toBe(`artifact-artifact-123.${extension}`);
  });

  it.each([
    ["screenshot", "png"],
    ["diff", "patch"],
    ["log", "txt"],
    ["dom_snapshot", "html"],
    ["http_trace", "json"],
    ["receipt", "txt"],
    ["file", "bin"],
    ["other", "bin"],
  ] as const)("falls back to the %s extension for %s artifacts", (kind, extension) => {
    expect(
      artifactFilenameFromMetadata({
        artifactId: "artifact-123",
        kind,
        mimeType: "application/octet-stream",
      }),
    ).toBe(`artifact-artifact-123.${extension}`);
  });
});
