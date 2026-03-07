// @vitest-environment jsdom

import { describe } from "vitest";
import { registerMemoryInspectorBrowseAndDetailTests } from "./memory-inspector.browse-detail.test-support.js";
import { registerMemoryInspectorEditingTests } from "./memory-inspector.editing.test-support.js";
import { registerMemoryInspectorExportAndSearchTests } from "./memory-inspector.export-search.test-support.js";
import { registerMemoryInspectorForgetTests } from "./memory-inspector.forget.test-support.js";

describe("MemoryInspector", () => {
  registerMemoryInspectorBrowseAndDetailTests();
  registerMemoryInspectorEditingTests();
  registerMemoryInspectorForgetTests();
  registerMemoryInspectorExportAndSearchTests();
});
