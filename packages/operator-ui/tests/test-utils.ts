// @vitest-environment jsdom

import { vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    readonly #callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }

    observe(target: Element): void {
      this.#callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this,
      );
    }

    unobserve(_target: Element): void {}

    disconnect(): void {}
  };
}

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

export function stubMatchMedia(
  query: string,
  initialMatches: boolean,
): {
  matchMedia: ReturnType<typeof vi.fn>;
  setMatches: (nextMatches: boolean) => void;
  cleanup: () => void;
} {
  const original = (globalThis as unknown as { matchMedia?: unknown }).matchMedia;

  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;

  const matchMedia = vi.fn((requestedQuery: string) => {
    if (requestedQuery !== query) {
      throw new Error(`Unexpected matchMedia query: ${requestedQuery}`);
    }
    return mediaQueryList;
  });

  (globalThis as unknown as { matchMedia?: unknown }).matchMedia = matchMedia;

  return {
    matchMedia,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of listeners) {
        listener({ matches: nextMatches, media: query } as MediaQueryListEvent);
      }
    },
    cleanup() {
      if (typeof original === "undefined") {
        delete (globalThis as unknown as { matchMedia?: unknown }).matchMedia;
        return;
      }
      (globalThis as unknown as { matchMedia?: unknown }).matchMedia = original;
    },
  };
}
