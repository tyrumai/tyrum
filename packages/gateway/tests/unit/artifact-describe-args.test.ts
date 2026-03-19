import { describe, expect, it } from "vitest";
import { normalizeArtifactDescribeArgs } from "../../src/modules/artifact/describe-args.js";

describe("normalizeArtifactDescribeArgs", () => {
  it("trims and deduplicates artifact ids while preserving the prompt", () => {
    expect(
      normalizeArtifactDescribeArgs({
        artifact_id: " 123e4567-e89b-12d3-a456-426614174000 ",
        artifact_ids: [
          "",
          "123e4567-e89b-12d3-a456-426614174000",
          " 123e4567-e89b-12d3-a456-426614174001 ",
          42,
        ],
        prompt: "  describe the screenshot  ",
      }),
    ).toEqual({
      artifactIds: ["123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001"],
      prompt: "describe the screenshot",
    });
  });
});
