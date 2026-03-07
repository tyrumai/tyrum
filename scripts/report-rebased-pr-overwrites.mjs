import { pathToFileURL } from "node:url";
import { main, toMarkdownReport } from "./report-rebased-pr-overwrites-report.mjs";
import { parseArgs, selectCurrentPrAnalysisWindow } from "./report-rebased-pr-overwrites-data.mjs";

export { main, parseArgs, selectCurrentPrAnalysisWindow, toMarkdownReport };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
