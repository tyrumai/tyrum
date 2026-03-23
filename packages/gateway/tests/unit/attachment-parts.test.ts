import { describe, expect, it } from "vitest";
import {
  isTextMessagePart,
  isFileMessagePart,
  renderTurnPartsText,
  createArtifactFilePart,
  normalizeTurnParts,
  buildUserTurnMessage,
} from "../../src/modules/ai-sdk/attachment-parts.js";
import type { TyrumUIMessagePart, ArtifactRef, NormalizedMessageEnvelope } from "@tyrum/contracts";

describe("isTextMessagePart", () => {
  it("returns true for text parts", () => {
    expect(isTextMessagePart({ type: "text", text: "hello" } as TyrumUIMessagePart)).toBe(true);
  });

  it("returns false for file parts", () => {
    expect(
      isTextMessagePart({
        type: "file",
        url: "http://example.com",
        mediaType: "text/plain",
      } as TyrumUIMessagePart),
    ).toBe(false);
  });

  it("returns false when text is missing", () => {
    expect(isTextMessagePart({ type: "text" } as TyrumUIMessagePart)).toBe(false);
  });
});

describe("isFileMessagePart", () => {
  it("returns true for file parts with url and mediaType", () => {
    expect(
      isFileMessagePart({
        type: "file",
        url: "http://example.com/file.txt",
        mediaType: "text/plain",
      } as TyrumUIMessagePart),
    ).toBe(true);
  });

  it("returns false for text parts", () => {
    expect(isFileMessagePart({ type: "text", text: "hello" } as TyrumUIMessagePart)).toBe(false);
  });

  it("returns false for file parts missing url", () => {
    expect(isFileMessagePart({ type: "file", mediaType: "text/plain" } as TyrumUIMessagePart)).toBe(
      false,
    );
  });

  it("returns false for file parts missing mediaType", () => {
    expect(
      isFileMessagePart({ type: "file", url: "http://example.com" } as TyrumUIMessagePart),
    ).toBe(false);
  });
});

describe("renderTurnPartsText", () => {
  it("renders text parts joined by double newlines", () => {
    const parts: TyrumUIMessagePart[] = [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ];
    expect(renderTurnPartsText(parts)).toBe("hello\n\nworld");
  });

  it("renders empty string for no parts", () => {
    expect(renderTurnPartsText([])).toBe("");
  });

  it("includes attachment summary for file parts", () => {
    const parts: TyrumUIMessagePart[] = [
      { type: "text", text: "check this" },
      { type: "file", url: "http://example.com/file.txt", mediaType: "text/plain" },
    ] as TyrumUIMessagePart[];
    const result = renderTurnPartsText(parts);
    expect(result).toContain("check this");
    expect(result).toContain("Attachments:");
    expect(result).toContain("mime_type=text/plain");
  });

  it("includes filename in attachment summary when available", () => {
    const parts: TyrumUIMessagePart[] = [
      {
        type: "file",
        url: "http://example.com/file.txt",
        mediaType: "text/plain",
        filename: "readme.txt",
      },
    ] as TyrumUIMessagePart[];
    const result = renderTurnPartsText(parts);
    expect(result).toContain("filename=readme.txt");
  });

  it("filters out empty text parts", () => {
    const parts: TyrumUIMessagePart[] = [
      { type: "text", text: "" },
      { type: "text", text: "  " },
      { type: "text", text: "valid" },
    ];
    expect(renderTurnPartsText(parts)).toBe("valid");
  });
});

describe("createArtifactFilePart", () => {
  it("returns a file part for an artifact with external_url", () => {
    const artifact: ArtifactRef = {
      artifact_id: "a1",
      external_url: "http://example.com/file.txt",
      mime_type: "text/plain",
      filename: "file.txt",
    } as ArtifactRef;
    const result = createArtifactFilePart(artifact);
    expect(result).toBeDefined();
    expect(result!.type).toBe("file");
    expect(result!.url).toBe("http://example.com/file.txt");
    expect(result!.mediaType).toBe("text/plain");
    expect(result!.filename).toBe("file.txt");
  });

  it("returns undefined when external_url is missing", () => {
    const artifact = {
      artifact_id: "a1",
      mime_type: "text/plain",
    } as ArtifactRef;
    expect(createArtifactFilePart(artifact)).toBeUndefined();
  });

  it("returns undefined when external_url is empty", () => {
    const artifact = {
      artifact_id: "a1",
      external_url: "  ",
      mime_type: "text/plain",
    } as ArtifactRef;
    expect(createArtifactFilePart(artifact)).toBeUndefined();
  });

  it("uses default media type when mime_type is null", () => {
    const artifact = {
      artifact_id: "a1",
      external_url: "http://example.com/file",
      mime_type: null,
    } as unknown as ArtifactRef;
    const result = createArtifactFilePart(artifact);
    expect(result).toBeDefined();
    expect(result!.mediaType).toBe("application/octet-stream");
  });

  it("omits filename when not available", () => {
    const artifact = {
      artifact_id: "a1",
      external_url: "http://example.com/file.txt",
      mime_type: "text/plain",
    } as ArtifactRef;
    const result = createArtifactFilePart(artifact);
    expect(result).toBeDefined();
    expect(result!.filename).toBeUndefined();
  });
});

describe("normalizeTurnParts", () => {
  it("returns cloned parts when parts exist", () => {
    const parts: TyrumUIMessagePart[] = [{ type: "text", text: "hello" }];
    const result = normalizeTurnParts({ parts });
    expect(result).toEqual([{ type: "text", text: "hello" }]);
    expect(result[0]).not.toBe(parts[0]); // cloned
  });

  it("returns empty array when no parts and no envelope", () => {
    expect(normalizeTurnParts({})).toEqual([]);
  });

  it("builds parts from envelope text", () => {
    const envelope: NormalizedMessageEnvelope = {
      content: {
        text: "  hello  ",
        attachments: [],
      },
      provenance: [],
    };
    const result = normalizeTurnParts({ envelope });
    expect(result).toEqual([{ type: "text", text: "hello" }]);
  });

  it("builds parts from envelope attachments", () => {
    const envelope: NormalizedMessageEnvelope = {
      content: {
        attachments: [
          {
            artifact_id: "a1",
            kind: "file",
            external_url: "http://example.com/file.txt",
            mime_type: "text/plain",
          },
        ],
      },
      provenance: [],
    };
    const result = normalizeTurnParts({ envelope });
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe("file");
  });

  it("skips envelope text when empty", () => {
    const envelope: NormalizedMessageEnvelope = {
      content: { text: "  ", attachments: [] },
      provenance: [],
    };
    expect(normalizeTurnParts({ envelope })).toEqual([]);
  });
});

describe("buildUserTurnMessage", () => {
  it("builds message from parts", () => {
    const parts: TyrumUIMessagePart[] = [{ type: "text", text: "hello" }];
    const msg = buildUserTurnMessage({ parts });
    expect(msg.role).toBe("user");
    expect(msg.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(msg.id).toBeDefined();
  });

  it("falls back to fallbackText when no parts", () => {
    const msg = buildUserTurnMessage({ fallbackText: "  fallback  " });
    expect(msg.parts).toEqual([{ type: "text", text: "fallback" }]);
  });

  it("returns empty parts when no parts and no fallbackText", () => {
    const msg = buildUserTurnMessage({});
    expect(msg.parts).toEqual([]);
  });

  it("returns empty parts when fallbackText is empty/whitespace", () => {
    const msg = buildUserTurnMessage({ fallbackText: "  " });
    expect(msg.parts).toEqual([]);
  });

  it("uses provided id", () => {
    const msg = buildUserTurnMessage({ id: "custom-id", fallbackText: "test" });
    expect(msg.id).toBe("custom-id");
  });
});
