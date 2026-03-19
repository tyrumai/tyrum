import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectBoundaryViolations,
  type BoundaryBaseline,
} from "../../../../scripts/lint/check-package-boundaries.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");

const emptyBaseline: BoundaryBaseline = {
  allowedImportEdges: [],
  allowedManifestEdges: [],
};

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

type FixturePackage = {
  name: string;
  relativeDir: string;
  dependencies?: Record<string, string>;
  files?: Record<string, string>;
};

async function createWorkspaceFixture(packages: readonly FixturePackage[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tyrum-package-boundaries-"));
  fixtureRoots.push(root);

  for (const pkg of packages) {
    const packageDir = resolve(root, pkg.relativeDir);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      resolve(packageDir, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          type: "module",
          version: "0.0.0-test",
          dependencies: pkg.dependencies ?? {},
        },
        null,
        2,
      ),
    );
    for (const [relativePath, contents] of Object.entries(pkg.files ?? {})) {
      const filePath = resolve(packageDir, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }
  }

  return root;
}

describe("package boundary lint", () => {
  it("allows the approved target-state edges", async () => {
    const repoRoot = await createWorkspaceFixture([
      {
        name: "@tyrum/contracts",
        relativeDir: "packages/contracts",
        files: {
          "src/index.ts": "export const contract = true;\n",
        },
      },
      {
        name: "@tyrum/operator-app",
        relativeDir: "packages/operator-app",
        dependencies: {
          "@tyrum/contracts": "workspace:*",
        },
        files: {
          "src/index.ts": 'export { contract } from "@tyrum/contracts";\n',
        },
      },
      {
        name: "@tyrum/operator-ui",
        relativeDir: "packages/operator-ui",
        dependencies: {
          "@tyrum/operator-app": "workspace:*",
        },
        files: {
          "src/index.ts": 'export { app } from "@tyrum/operator-app";\n',
        },
      },
    ]);

    await writeFile(
      resolve(repoRoot, "packages/operator-app/src/index.ts"),
      'export const app = "ok";\nexport { contract } from "@tyrum/contracts";\n',
    );

    const violations = await collectBoundaryViolations({
      baseline: emptyBaseline,
      repoRoot,
    });

    expect(violations).toEqual([]);
  });

  it("rejects forbidden target-package edges", async () => {
    const repoRoot = await createWorkspaceFixture([
      {
        name: "@tyrum/contracts",
        relativeDir: "packages/contracts",
      },
      {
        name: "@tyrum/transport-sdk",
        relativeDir: "packages/transport-sdk",
        dependencies: {
          "@tyrum/contracts": "workspace:*",
        },
        files: {
          "src/index.ts": 'export const transport = "transport";\n',
        },
      },
      {
        name: "@tyrum/operator-ui",
        relativeDir: "packages/operator-ui",
        dependencies: {
          "@tyrum/transport-sdk": "workspace:*",
        },
        files: {
          "src/index.ts": 'export { transport } from "@tyrum/transport-sdk";\n',
        },
      },
    ]);

    const violations = await collectBoundaryViolations({
      baseline: emptyBaseline,
      repoRoot,
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPackage: "@tyrum/operator-ui",
          kind: "forbidden-target-manifest-edge",
          toPackage: "@tyrum/transport-sdk",
        }),
        expect.objectContaining({
          fromPackage: "@tyrum/operator-ui",
          kind: "forbidden-target-import-edge",
          toPackage: "@tyrum/transport-sdk",
        }),
      ]),
    );
  });

  it("allows self-referencing target-package imports", async () => {
    const repoRoot = await createWorkspaceFixture([
      {
        name: "@tyrum/contracts",
        relativeDir: "packages/contracts",
      },
      {
        name: "@tyrum/operator-app",
        relativeDir: "packages/operator-app",
        dependencies: {
          "@tyrum/contracts": "workspace:*",
        },
        files: {
          "src/index.ts": 'export { feature } from "@tyrum/operator-app/internal";\n',
          "src/internal.ts": 'export const feature = "ok";\n',
        },
      },
    ]);

    const violations = await collectBoundaryViolations({
      baseline: emptyBaseline,
      repoRoot,
    });

    expect(violations).toEqual([]);
  });

  it("rejects new legacy-package edges once the replacement package exists", async () => {
    const repoRoot = await createWorkspaceFixture([
      {
        name: "@tyrum/contracts",
        relativeDir: "packages/contracts",
      },
      {
        name: "@tyrum/transport-sdk",
        relativeDir: "packages/transport-sdk",
      },
      {
        name: "@tyrum/node-sdk",
        relativeDir: "packages/node-sdk",
      },
      {
        name: "@tyrum/client",
        relativeDir: "packages/client",
        files: {
          "src/index.ts": 'export const schema = "schema";\n',
        },
      },
      {
        name: "@tyrum/web-fixture",
        relativeDir: "apps/web-fixture",
        dependencies: {
          "@tyrum/client": "workspace:*",
        },
        files: {
          "src/main.ts": 'export { schema } from "@tyrum/client";\n',
        },
      },
    ]);

    const violations = await collectBoundaryViolations({
      baseline: emptyBaseline,
      repoRoot,
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPackage: "@tyrum/web-fixture",
          kind: "legacy-manifest-edge",
          replacementPackages: ["@tyrum/transport-sdk", "@tyrum/node-sdk"],
          toPackage: "@tyrum/client",
        }),
        expect.objectContaining({
          fromFile: "apps/web-fixture/src/main.ts",
          kind: "legacy-import-edge",
          replacementPackages: ["@tyrum/transport-sdk", "@tyrum/node-sdk"],
          toPackage: "@tyrum/client",
        }),
      ]),
    );
  });

  it("respects exact temporary coexistence allowlists", async () => {
    const repoRoot = await createWorkspaceFixture([
      {
        name: "@tyrum/contracts",
        relativeDir: "packages/contracts",
      },
      {
        name: "@tyrum/transport-sdk",
        relativeDir: "packages/transport-sdk",
      },
      {
        name: "@tyrum/node-sdk",
        relativeDir: "packages/node-sdk",
      },
      {
        name: "@tyrum/client",
        relativeDir: "packages/client",
      },
      {
        name: "@tyrum/web-fixture",
        relativeDir: "apps/web-fixture",
        dependencies: {
          "@tyrum/client": "workspace:*",
        },
        files: {
          "src/main.ts": 'export { schema } from "@tyrum/client";\n',
        },
      },
    ]);

    const violations = await collectBoundaryViolations({
      baseline: {
        allowedImportEdges: [
          {
            fromFile: "apps/web-fixture/src/main.ts",
            reason: "#1532 temporary coexistence during transport-sdk migration",
            toPackage: "@tyrum/client",
          },
        ],
        allowedManifestEdges: [
          {
            fromPackage: "@tyrum/web-fixture",
            reason: "#1532 temporary coexistence during transport-sdk migration",
            toPackage: "@tyrum/client",
          },
        ],
      },
      repoRoot,
    });

    expect(violations).toEqual([]);
  });

  it("wires the boundary check into lint, CI, and contributor docs", async () => {
    const rootPackageJson = JSON.parse(
      await readFile(resolve(REPO_ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const workflow = await readFile(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const archDecisionDoc = await readFile(
      resolve(REPO_ROOT, "docs/architecture/reference/arch-01-clean-break-target-state.md"),
      "utf8",
    );
    const targetStateDoc = await readFile(
      resolve(REPO_ROOT, "docs/architecture/target-state.md"),
      "utf8",
    );

    expect(rootPackageJson.scripts?.["lint:boundaries"]).toBe(
      "node scripts/lint/check-package-boundaries.mjs",
    );
    expect(rootPackageJson.scripts?.lint).toContain("pnpm lint:boundaries");
    expect(workflow).toContain('- "scripts/lint/**"');
    expect(workflow).toContain("run: pnpm lint");
    expect(archDecisionDoc).toContain("scripts/lint/package-boundaries.config.mjs");
    expect(targetStateDoc).toContain("pnpm lint:boundaries");
    expect(targetStateDoc).toContain("scripts/lint/package-boundaries.config.mjs");
    expect(targetStateDoc).toContain("scripts/lint/package-boundaries-baseline.json");
  });
});
