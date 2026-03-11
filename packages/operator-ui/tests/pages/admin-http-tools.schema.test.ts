import { describe, expect, it } from "vitest";
import { buildStructuredToolSchema } from "../../src/components/pages/admin-http-tools.schema.js";

describe("buildStructuredToolSchema", () => {
  it("flattens nested object and array fields", () => {
    const schema = buildStructuredToolSchema({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path.",
        },
        options: {
          type: "object",
          properties: {
            offset: {
              type: "number",
              description: "Line offset.",
            },
            tags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  value: { type: "string" },
                },
                required: ["value"],
              },
            },
          },
          required: ["offset"],
          additionalProperties: false,
        },
      },
      required: ["path"],
      additionalProperties: false,
    });

    expect(schema?.sections).toHaveLength(1);
    expect(schema?.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "path",
          type: "string",
          required: true,
          description: "Absolute path.",
        }),
        expect.objectContaining({
          field: "options.offset",
          type: "number",
          required: true,
          description: "Line offset.",
        }),
        expect.objectContaining({
          field: "options.tags",
          type: "array<object>",
          required: false,
        }),
        expect.objectContaining({
          field: "options.tags[].value",
          type: "string",
          required: true,
        }),
      ]),
    );
    expect(schema?.sections[0]?.summary).toBe("Additional fields not allowed.");
  });

  it("creates labeled sections for oneOf variants", () => {
    const schema = buildStructuredToolSchema({
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fact"] },
            key: { type: "string" },
          },
          required: ["kind", "key"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["note"] },
            body_md: { type: "string" },
          },
          required: ["kind", "body_md"],
          additionalProperties: false,
        },
      ],
    });

    expect(schema?.sections.map((section) => section.label)).toEqual(["fact", "note"]);
    expect(schema?.sections.map((section) => section.id)).toEqual(["variant-1", "variant-2"]);
    expect(schema?.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", type: "string (fact)", required: true }),
        expect.objectContaining({ field: "key", type: "string", required: true }),
      ]),
    );
    expect(schema?.sections[1]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", type: "string (note)", required: true }),
        expect.objectContaining({ field: "body_md", type: "string", required: true }),
      ]),
    );
  });

  it("keeps unique section ids when oneOf labels repeat", () => {
    const schema = buildStructuredToolSchema({
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fact"] },
            key: { type: "string" },
          },
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fact"] },
            body_md: { type: "string" },
          },
        },
      ],
    });

    expect(schema?.sections.map((section) => section.label)).toEqual(["fact", "fact"]);
    expect(schema?.sections.map((section) => section.id)).toEqual(["variant-1", "variant-2"]);
  });
});
