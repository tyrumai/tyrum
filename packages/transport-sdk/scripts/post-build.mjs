import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/node", { recursive: true });
writeFileSync(
  "dist/node/pinned-transport.js",
  [
    "// Bridge file: re-exports pinned-transport functions from the node entrypoint",
    "// where tsdown inlines them. Needed because the dynamic import in the shared",
    "// chunk resolves to this path at runtime (see load-node-pinned-transport.ts).",
    'export { createPinnedNodeTransportState, createPinnedNodeWebSocket, destroyPinnedNodeDispatcher } from "../node.mjs";',
    "",
  ].join("\n"),
);
