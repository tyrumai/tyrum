// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export interface TestRoot {
  container: HTMLDivElement;
  root: Root;
}

export function createTestRoot(): TestRoot {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

export function renderIntoDocument(element: React.ReactElement): TestRoot {
  const testRoot = createTestRoot();
  act(() => {
    testRoot.root.render(element);
  });
  return testRoot;
}

export function cleanupTestRoot(testRoot: TestRoot): void {
  act(() => {
    testRoot.root.unmount();
  });
  testRoot.container.remove();
}
