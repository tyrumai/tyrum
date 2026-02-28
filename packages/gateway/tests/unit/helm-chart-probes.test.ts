import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

function extractYamlBlock(yaml: string, key: string): string {
  const lines = yaml.split(/\r?\n/);
  const keyRegex = new RegExp(`^(\\s*)${key}:\\s*(?:#.*)?$`);

  let startIndex = -1;
  let keyIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.match(keyRegex);
    if (!match) continue;

    startIndex = i + 1;
    keyIndent = match[1]?.length ?? 0;
    break;
  }

  if (startIndex === -1) return "";

  const block: string[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      block.push(line);
      continue;
    }

    const lineIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (lineIndent <= keyIndent) break;
    block.push(line);
  }

  return block.join("\n");
}

function extractYamlInt(block: string, key: string): number | undefined {
  const match = block.match(new RegExp(`^\\s*${key}:\\s*(\\d+)\\s*(?:#.*)?$`, "m"));
  if (!match) return undefined;
  return Number.parseInt(match[1] ?? "", 10);
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Helm chart probes", () => {
  const valuesUrl = new URL("../../../../charts/tyrum/values.yaml", import.meta.url);
  const helpersUrl = new URL("../../../../charts/tyrum/templates/_helpers.tpl", import.meta.url);
  const singleUrl = new URL(
    "../../../../charts/tyrum/templates/deployment-single.yaml",
    import.meta.url,
  );
  const splitUrl = new URL(
    "../../../../charts/tyrum/templates/deployment-split.yaml",
    import.meta.url,
  );

  test("values.yaml defines probe defaults", () => {
    const values = readFileSync(fileURLToPath(valuesUrl), "utf8");

    const probesBlock = extractYamlBlock(values, "probes");
    expect(probesBlock).not.toEqual("");

    const readinessBlock = extractYamlBlock(probesBlock, "readiness");
    expect(extractYamlInt(readinessBlock, "initialDelaySeconds")).toBe(5);
    expect(extractYamlInt(readinessBlock, "periodSeconds")).toBe(5);

    const livenessBlock = extractYamlBlock(probesBlock, "liveness");
    expect(extractYamlInt(livenessBlock, "initialDelaySeconds")).toBe(15);
    expect(extractYamlInt(livenessBlock, "periodSeconds")).toBe(10);

    const startupBlock = extractYamlBlock(probesBlock, "startup");
    expect(extractYamlInt(startupBlock, "failureThreshold")).toBe(30);
  });

  test("deployment templates include readiness/liveness/startup probes", () => {
    const single = readFileSync(fileURLToPath(singleUrl), "utf8");
    const split = readFileSync(fileURLToPath(splitUrl), "utf8");

    expect(single).toContain("readinessProbe:");
    expect(single).toContain("livenessProbe:");
    expect(single).toContain("startupProbe:");

    // In split mode, only the edge role serves HTTP (/healthz).
    expect(countOccurrences(split, "readinessProbe:")).toBe(1);
    expect(countOccurrences(split, "livenessProbe:")).toBe(1);
    expect(countOccurrences(split, "startupProbe:")).toBe(1);

    const docs = split.split(/\n---\n/);
    const edge = docs.find((doc) => doc.includes("-edge") && doc.includes('args: ["edge"]'));
    const worker = docs.find((doc) => doc.includes("-worker") && doc.includes('args: ["worker"]'));
    const scheduler = docs.find(
      (doc) => doc.includes("-scheduler") && doc.includes('args: ["scheduler"]'),
    );

    expect(edge).toContain("startupProbe:");
    expect(edge).toContain("readinessProbe:");
    expect(edge).toContain("livenessProbe:");

    expect(worker).not.toContain("startupProbe:");
    expect(worker).not.toContain("readinessProbe:");
    expect(worker).not.toContain("livenessProbe:");

    expect(scheduler).not.toContain("startupProbe:");
    expect(scheduler).not.toContain("readinessProbe:");
    expect(scheduler).not.toContain("livenessProbe:");
  });

  test("_helpers.tpl defines a reusable probe template for /healthz", () => {
    const helpers = readFileSync(fileURLToPath(helpersUrl), "utf8");

    expect(helpers).toContain(`define "tyrum.probe"`);
    expect(helpers).toContain("path: /healthz");
  });
});
