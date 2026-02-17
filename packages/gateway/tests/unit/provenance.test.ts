import { describe, it, expect } from "vitest";
import { tagContent } from "../../src/modules/agent/provenance.js";
import type { ProvenanceTag } from "../../src/modules/agent/provenance.js";

describe("tagContent", () => {
  it("tags user content as trusted by default", () => {
    const tagged = tagContent("hello", "user");
    expect(tagged.content).toBe("hello");
    expect(tagged.source).toBe("user");
    expect(tagged.trusted).toBe(true);
  });

  it("tags memory content as trusted by default", () => {
    const tagged = tagContent("remembered fact", "memory");
    expect(tagged.trusted).toBe(true);
  });

  it("tags semantic-memory content as trusted by default", () => {
    const tagged = tagContent("vector search result", "semantic-memory");
    expect(tagged.trusted).toBe(true);
  });

  it("tags web content as untrusted by default", () => {
    const tagged = tagContent("web page content", "web");
    expect(tagged.trusted).toBe(false);
  });

  it("tags tool content as untrusted by default", () => {
    const tagged = tagContent("tool output", "tool");
    expect(tagged.trusted).toBe(false);
  });

  it("tags email content as untrusted by default", () => {
    const tagged = tagContent("email body", "email");
    expect(tagged.trusted).toBe(false);
  });

  it("allows overriding trust level to true", () => {
    const tagged = tagContent("trusted tool output", "tool", true);
    expect(tagged.trusted).toBe(true);
  });

  it("allows overriding trust level to false", () => {
    const tagged = tagContent("untrusted user input", "user", false);
    expect(tagged.trusted).toBe(false);
  });

  it("preserves content exactly", () => {
    const content = "  line1\n  line2\n  special chars: <>&\"'  ";
    const tagged = tagContent(content, "user");
    expect(tagged.content).toBe(content);
  });

  it("handles all provenance tag values", () => {
    const tags: ProvenanceTag[] = ["user", "email", "web", "tool", "memory", "semantic-memory"];
    for (const tag of tags) {
      const tagged = tagContent("test", tag);
      expect(tagged.source).toBe(tag);
    }
  });
});
