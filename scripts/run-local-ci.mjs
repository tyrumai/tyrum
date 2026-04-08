#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const shouldUseXvfb = process.argv.includes("--linux") || process.platform === "linux";
const coverageArgs = ["test", "--coverage.enabled", "--coverage.reporter=text-summary"];

const ciSteps = [
  [pnpmCommand, ["install", "--frozen-lockfile"]],
  [pnpmCommand, ["typecheck"]],
  [pnpmCommand, ["exec", "tsc", "--noEmit", "--project", "apps/desktop/tsconfig.json"]],
  [pnpmCommand, ["lint"]],
  [pnpmCommand, ["i18n:check"]],
  [pnpmCommand, ["docs:public-check"]],
  [pnpmCommand, ["format:check"]],
  [pnpmCommand, ["build"]],
  [pnpmCommand, ["--filter", "tyrum-desktop", "exec", "playwright", "install", "chromium"]],
  shouldUseXvfb
    ? [
        "bash",
        [
          "scripts/xvfb-run-safe.sh",
          "-a",
          "--server-args=-screen 0 1920x1080x24",
          "--",
          "pnpm",
          ...coverageArgs,
        ],
      ]
    : [pnpmCommand, coverageArgs],
];

for (const [command, args] of ciSteps) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
