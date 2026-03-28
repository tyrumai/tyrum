import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const scriptPath = resolve(repoRoot, "scripts/check-public-docs.sh");
const tempDirs: string[] = [];

const buildWord = (...codes: number[]): string => String.fromCharCode(...codes);
const legacyPlural = buildWord(108, 97, 110, 101, 115);
const legacyIdentifier = `foo_${buildWord(108, 97, 110, 101)}`;
const legacyToken = `${buildWord(115, 101, 115, 115, 105, 111, 110)}_token`;

function createFixtureDir(): {
  docsDir: string;
  contractsDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), "tyrum-public-docs-"));
  tempDirs.push(root);
  const docsDir = join(root, "docs");
  const architectureDir = join(docsDir, "architecture");
  const contractsDir = join(root, "contracts");
  mkdirSync(architectureDir, { recursive: true });
  mkdirSync(contractsDir, { recursive: true });
  return { docsDir, contractsDir };
}

function writeArchitectureDoc(docsDir: string, name: string, content: string): void {
  writeFileSync(join(docsDir, "architecture", name), content, "utf8");
}

function writeContractFile(contractsDir: string, name: string, content: string): void {
  writeFileSync(join(contractsDir, name), content, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("check-public-docs", () => {
  it("allows compounds like backplane and control-plane", () => {
    const { docsDir, contractsDir } = createFixtureDir();
    writeArchitectureDoc(
      docsDir,
      "allowed.md",
      "Backplane routing and control-plane coordination are valid architecture terms.\n",
    );
    writeContractFile(contractsDir, "allowed.ts", "export const conversationKey = 'ok';\n");

    const stdout = execFileSync("bash", [scriptPath, docsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PUBLIC_CONTRACTS_DIR: contractsDir,
      },
    });

    expect(stdout).toContain("public docs policy check passed");
  });

  it("blocks standalone and identifier legacy vocabulary variants", () => {
    const { docsDir, contractsDir } = createFixtureDir();
    writeArchitectureDoc(
      docsDir,
      "blocked.md",
      `These docs must not mention ${legacyPlural} or ${legacyIdentifier} identifiers.\n`,
    );
    writeContractFile(contractsDir, "blocked.ts", `export const ${legacyToken} = 'bad';\n`);

    const result = spawnSync("bash", [scriptPath, docsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PUBLIC_CONTRACTS_DIR: contractsDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("blocked clean-break vocabulary");
    expect(result.stderr).toContain(legacyPlural);
    expect(result.stderr).toContain(legacyToken);
  });
});
