import { describe, expect, it } from "vitest";
import { createTyrumManualChunk } from "../../../scripts/vite/manual-chunks.mjs";

describe("createTyrumManualChunk", () => {
  it("skips vendor packages that tree-shake to empty chunks", () => {
    const emptyChunkIds = [
      "/repo/node_modules/@ai-sdk/gateway/dist/index.js",
      "/repo/node_modules/@opentelemetry/api/build/src/index.js",
      "/repo/node_modules/@vercel/oidc/dist/index.js",
      "/repo/node_modules/dequal/dist/index.mjs",
      "/repo/node_modules/use-sync-external-store/shim/index.js",
    ];

    for (const id of emptyChunkIds) {
      expect(createTyrumManualChunk(id)).toBeUndefined();
    }
  });

  it("still assigns shared vendor chunks for non-empty dependencies", () => {
    expect(createTyrumManualChunk("/repo/node_modules/@radix-ui/react-tabs/dist/index.mjs")).toBe(
      "vendor-radix-ui-react-tabs",
    );
  });
});
