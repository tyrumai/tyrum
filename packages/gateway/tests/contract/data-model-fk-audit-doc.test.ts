import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("docs: data model fk audit", () => {
  it("documents enforced vs soft references for the audited columns", async () => {
    const docUrl = new URL(
      "../../../../docs/architecture/scaling-ha/data-model-fk-audit.md",
      import.meta.url,
    );

    let content: string | undefined;
    try {
      content = await readFile(docUrl, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    expect(content, "docs/architecture/scaling-ha/data-model-fk-audit.md should exist").toBeTypeOf(
      "string",
    );
    expect(content).toContain("channel_outbox.approval_id");
    expect(content).toContain("policy_overrides.created_from_approval_id");
    expect(content).toContain("approvals.run_id");
    expect(content).toContain("Soft reference");
    expect(content).toContain("Cleanup / retention");
    expect(content).toContain("must clear the child ref first");
  });
});
