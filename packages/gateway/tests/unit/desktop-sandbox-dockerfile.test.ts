import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("desktop-sandbox Dockerfile", () => {
  const binUrl = new URL(
    "../../../../packages/desktop-node/bin/tyrum-desktop-node.mjs",
    import.meta.url,
  );
  const dockerfileUrl = new URL("../../../../docker/desktop-sandbox/Dockerfile", import.meta.url);
  const nativeCheckUrl = new URL(
    "../../../../scripts/check-desktop-sandbox-native.mjs",
    import.meta.url,
  );

  test("copies the shared bootstrap helper when the desktop-node bin imports it", () => {
    const bin = readFileSync(fileURLToPath(binUrl), "utf8");
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(bin).toContain("package-bin-bootstrap.mjs");
    expect(dockerfile).toContain("COPY --from=builder /app/scripts ./scripts");
  });

  test("runs the desktop native preflight during the builder stage", () => {
    const nativeCheck = readFileSync(fileURLToPath(nativeCheckUrl), "utf8");
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(nativeCheck).toContain("@nut-tree-fork/nut-js");
    expect(dockerfile).toContain("RUN node ./scripts/check-desktop-sandbox-native.mjs");
  });

  test("copies and builds transport-sdk before client in the builder stage", () => {
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(dockerfile).toContain("COPY packages/transport-sdk ./packages/transport-sdk");
    expect(dockerfile).toContain("pnpm --filter @tyrum/transport-sdk build");
    expect(dockerfile.indexOf("pnpm --filter @tyrum/transport-sdk build")).toBeLessThan(
      dockerfile.indexOf("pnpm --filter @tyrum/client build"),
    );
  });

  test("copies transport-sdk into the runtime image for workspace package resolution", () => {
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(dockerfile).toContain(
      "COPY --from=builder /app/packages/transport-sdk/package.json ./packages/transport-sdk/package.json",
    );
    expect(dockerfile).toContain(
      "COPY --from=builder /app/packages/transport-sdk/dist ./packages/transport-sdk/dist",
    );
  });

  test("installs Playwright before copying frequently changing build outputs", () => {
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(dockerfile.indexOf("COPY --from=builder /app/node_modules ./node_modules")).toBeLessThan(
      dockerfile.indexOf("RUN npx playwright install --with-deps chromium"),
    );
    expect(dockerfile.indexOf("RUN npx playwright install --with-deps chromium")).toBeLessThan(
      dockerfile.indexOf("COPY --from=builder /app/scripts ./scripts"),
    );
  });
});
