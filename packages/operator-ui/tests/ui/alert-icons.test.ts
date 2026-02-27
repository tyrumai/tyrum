import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Alert icons", () => {
  it("uses canonical lucide-react icon names (no deprecated aliases)", async () => {
    const source = await readFile(resolve(__dirname, "../../src/components/ui/alert.tsx"), "utf8");

    expect(source).toContain('from "lucide-react"');
    expect(source).not.toMatch(/\bCheckCircle2\b/u);
    expect(source).not.toMatch(/\bAlertTriangle\b/u);
    expect(source).not.toMatch(/\bXCircle\b/u);
  });
});

