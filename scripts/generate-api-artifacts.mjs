import { writeApiArtifacts } from "./api/generator-lib.mjs";

const result = await writeApiArtifacts();

process.stdout.write(
  `generated API artifacts: ${result.metadata.httpOperationCount} HTTP operations, ${result.metadata.wsRequestCount} WS requests, ${result.metadata.wsEventCount} WS events\n`,
);
