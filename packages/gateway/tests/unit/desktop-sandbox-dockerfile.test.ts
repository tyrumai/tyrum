import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("desktop-sandbox Dockerfile", () => {
  const binUrl = new URL(
    "../../../../packages/desktop-node/bin/tyrum-desktop-node.mjs",
    import.meta.url,
  );
  const dockerfileUrl = new URL("../../../../docker/desktop-sandbox/Dockerfile", import.meta.url);

  test("copies the shared bootstrap helper when the desktop-node bin imports it", () => {
    const bin = readFileSync(fileURLToPath(binUrl), "utf8");
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(bin).toContain("package-bin-bootstrap.mjs");
    expect(dockerfile).toContain("COPY --from=builder /app/scripts ./scripts");
  });
});
