import { generateApiArtifacts } from "./api/generator-lib.mjs";
import { readFile } from "node:fs/promises";

const generated = await generateApiArtifacts();
let hasDiff = false;

for (const file of generated.files) {
  const existing = await readFile(file.path, "utf8").catch(() => "");
  if (existing === file.content) {
    continue;
  }
  hasDiff = true;
  process.stderr.write(`generated API artifact is out of date: ${file.path}\n`);
}

if (hasDiff) {
  process.exitCode = 1;
} else {
  process.stdout.write("generated API artifacts are up to date\n");
}
