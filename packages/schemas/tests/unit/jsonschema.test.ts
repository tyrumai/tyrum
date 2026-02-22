import { describe, expect, it } from "vitest";
import { Approval, PolicyBundle, SnapshotBundle, WsMessageEnvelope } from "@tyrum/schemas";

describe("@tyrum/schemas JSON Schema export", () => {
  it("can export key contracts to JSON Schema", () => {
    const schemas = [
      WsMessageEnvelope.toJSONSchema(),
      Approval.toJSONSchema(),
      PolicyBundle.toJSONSchema(),
      SnapshotBundle.toJSONSchema(),
    ];

    for (const schema of schemas) {
      expect(schema).toBeTypeOf("object");
      expect(schema).toHaveProperty("$schema");
    }
  });
});

