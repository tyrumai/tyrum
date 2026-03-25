import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("desktop CI build jobs mark packaged bundles for smoke reuse", () => {
  const workflowPath = fileURLToPath(
    new URL("../../../../.github/workflows/ci.yml", import.meta.url),
  );
  const workflow = readFileSync(workflowPath, "utf8");

  expect(workflow.match(/Mark packaged desktop bundle ready for smoke reuse/gu)?.length ?? 0).toBe(
    2,
  );
  expect(
    workflow.match(/node apps\/desktop\/scripts\/write-packaged-smoke-stamp\.mjs/gu)?.length ?? 0,
  ).toBe(2);
});
