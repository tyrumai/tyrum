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
const legacyRunId = `${buildWord(114, 117, 110)}_id`;
const legacyRunPhrase = "run-level budgets";
const legacyRunNounPhrase = "later runs";

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
      [
        "Backplane routing and control-plane coordination are valid architecture terms.",
        "Run pnpm lint locally when you need to verify the workspace boundary gate.",
        "Nodes can run on a variety of devices without reviving the old execution model.",
      ].join("\n"),
    );
    writeContractFile(
      contractsDir,
      "allowed.ts",
      ["export const conversationKey = 'ok';", "export const action = 'run';"].join("\n"),
    );

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

  it("blocks standalone, identifier, and run-era legacy vocabulary variants", () => {
    const { docsDir, contractsDir } = createFixtureDir();
    writeArchitectureDoc(
      docsDir,
      "blocked.md",
      `These docs must not mention ${legacyPlural}, ${legacyIdentifier}, or ${legacyRunNounPhrase}.\n`,
    );
    writeContractFile(
      contractsDir,
      "blocked.ts",
      `export const ${legacyToken} = 'bad';\n/** ${legacyRunPhrase} */\nexport const ${legacyRunId} = 'bad';\n`,
    );

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
    expect(result.stderr).toContain(legacyRunPhrase);
    expect(result.stderr).toContain(legacyRunId);
  });

  it("blocks legacy vocabulary in filenames even when file contents are clean", () => {
    const { docsDir, contractsDir } = createFixtureDir();
    writeArchitectureDoc(docsDir, "run-level-budgets.md", "Clean content only.\n");
    writeContractFile(contractsDir, "session-foo.ts", "export const conversationKey = 'ok';\n");

    const result = spawnSync("bash", [scriptPath, docsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PUBLIC_CONTRACTS_DIR: contractsDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "blocked clean-break vocabulary found in architecture doc filenames",
    );
    expect(result.stderr).toContain("run-level-budgets.md");
    expect(result.stderr).toContain(
      "blocked clean-break vocabulary found in public contract filenames",
    );
    expect(result.stderr).toContain("session-foo.ts");
  });
});
