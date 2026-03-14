import { expect, test } from "vitest";
import {
  applyLoopGuardPatch,
  hasLoopGuard,
  injectLoopGuard,
} from "../../../../scripts/check-file-type-patch.mjs";

function makeAsfLoopSource(ignorePayloadBlock = "\t\t\tawait tokenizer.ignore(payload);\n\t\t}") {
  return [
    "async function parseAsf() {",
    "\t\twhile (tokenizer.position + 24 < tokenizer.fileInfo.size) {",
    "\t\t\tconst header = await readHeader();",
    "\t\t\tconst payload = header.objectSize - headerHeaderLen;",
    ignorePayloadBlock,
    "\t}",
    "}",
    "",
  ].join("\n");
}

test("applyLoopGuardPatch only writes fully guarded source", () => {
  const source = makeAsfLoopSource("\t\t\tawait tokenizer.ignore(payload);\n\t\t\t}");

  const patched = applyLoopGuardPatch(source);

  expect(patched).toBe(source);
  expect(hasLoopGuard(patched)).toBe(false);
});

test("injectLoopGuard inserts the ASF tokenizer progress guard when the expected block exists", () => {
  const source = makeAsfLoopSource();

  const patched = injectLoopGuard(source);

  expect(hasLoopGuard(patched)).toBe(true);
  expect(patched).toContain("const previousPosition = tokenizer.position;");
  expect(patched).toContain("if (tokenizer.position <= previousPosition) {");
});
