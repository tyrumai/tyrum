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

/**
 * Sets a value on a React-controlled input/textarea by going through the
 * native property setter so React's internal value tracker is updated.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Click helper that dispatches the full pointer/mouse sequence Radix components expect. */
export function clickRadix(element: HTMLElement): void {
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.click();
  element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

export const click = clickRadix;

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
  const extraLists = new Map<string, MediaQueryList>();

  const createList = (
    media: string,
    getMatches: () => boolean,
    setListeners?: Set<(event: MediaQueryListEvent) => void>,
  ) =>
    ({
      get matches() {
        return getMatches();
      },
      media,
      addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
        setListeners?.add(listener);
      },
      removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
        setListeners?.delete(listener);
      },
    }) as unknown as MediaQueryList;

  const mediaQueryList = createList(query, () => matches, listeners);

  const matchMedia = vi.fn((requestedQuery: string) => {
    if (requestedQuery === query) {
      return mediaQueryList;
    }
    const existing = extraLists.get(requestedQuery);
    if (existing) {
      return existing;
    }
    const fallbackList = createList(requestedQuery, () => false);
    extraLists.set(requestedQuery, fallbackList);
    return fallbackList;
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

export function stubAppShellContentWidth(initialWidth: number) {
  const originalResizeObserver = globalThis.ResizeObserver;
  let resizeObserverCallback: ResizeObserverCallback | null = null;
  let observedElement: Element | null = null;
  let measuredWidth = initialWidth;

  const isMeasuredElement = (element: unknown): element is HTMLElement =>
    element instanceof HTMLElement &&
    typeof element.className === "string" &&
    element.className.includes("min-w-0 flex-1 flex-col overflow-hidden");

  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }

    observe(target: Element): void {
      observedElement = target;
    }

    unobserve(_target: Element): void {}

    disconnect(): void {}
  };

  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (_element: Element) =>
      ({
        paddingLeft: "0px",
        paddingRight: "0px",
      }) as CSSStyleDeclaration,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isMeasuredElement(this) ? measuredWidth : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return {
      width: isMeasuredElement(this) ? measuredWidth : 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });

  return {
    setWidth(nextWidth: number) {
      measuredWidth = nextWidth;
    },
    notifyResize() {
      act(() => {
        resizeObserverCallback?.(
          [
            {
              target: observedElement as Element,
              contentRect: { width: measuredWidth } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });
    },
    cleanup() {
      globalThis.ResizeObserver = originalResizeObserver;
    },
  };
}
