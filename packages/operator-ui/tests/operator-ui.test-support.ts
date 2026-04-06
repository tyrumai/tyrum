import { expect, vi } from "vitest";
import { act } from "react";

export type Handler = (data: unknown) => void;

export async function waitForSelector<T extends Element>(
  container: HTMLElement,
  selector: string,
  attempts = 50,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = container.querySelector<T>(selector);
    if (element) return element;
    await act(async () => {
      await Promise.resolve();
      await vi.dynamicImportSettled();
    });
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

export async function openConfigureGeneral(container: HTMLElement): Promise<void> {
  const configureLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-configure"]');
  expect(configureLink).not.toBeNull();

  await act(async () => {
    configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });

  const generalTab = await waitForSelector<HTMLButtonElement>(
    container,
    '[data-testid="configure-tab-general"]',
  );

  await act(async () => {
    generalTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

export async function openConfigureTab(
  container: HTMLElement,
  tabTestId = "admin-http-tab-gateway",
): Promise<void> {
  const configureLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-configure"]');
  expect(configureLink).not.toBeNull();

  await act(async () => {
    configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });

  const tab = await waitForSelector<HTMLButtonElement>(container, `[data-testid="${tabTestId}"]`);

  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await Promise.resolve();
  });
}

export const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
] as const;

export const TEST_DEVICE_IDENTITY = {
  deviceId: "operator-ui-device-1",
  publicKey: "test-public-key",
  privateKey: "test-private-key",
} as const;

export function setControlledInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as
    | ((this: HTMLInputElement, value: string) => void)
    | undefined;
  if (!setValue) {
    throw new Error("Failed to resolve HTMLInputElement value setter");
  }
  setValue.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function clickButtonByTestId(container: HTMLElement, testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

export function clickTabByLabel(container: HTMLElement, label: string): void {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) =>
    el.textContent?.includes(label),
  );
  expect(tab).not.toBeUndefined();
  tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
}

export function requestInfoToUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function stubUrlObjectUrls(): { restore: () => void } {
  const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;

  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:json"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(() => {}),
    configurable: true,
  });

  return {
    restore: () => {
      if (typeof originalCreateObjectURL === "undefined") {
        Reflect.deleteProperty(URL, "createObjectURL");
      } else {
        Object.defineProperty(URL, "createObjectURL", {
          value: originalCreateObjectURL,
          configurable: true,
        });
      }

      if (typeof originalRevokeObjectURL === "undefined") {
        Reflect.deleteProperty(URL, "revokeObjectURL");
      } else {
        Object.defineProperty(URL, "revokeObjectURL", {
          value: originalRevokeObjectURL,
          configurable: true,
        });
      }
    },
  };
}

function createStorageMock(storage: Map<string, string>): Storage {
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  } as unknown as Storage;
}

export function stubPersistentStorage(params?: {
  conversation?: Map<string, string>;
  local?: Map<string, string>;
}): {
  conversation: Map<string, string>;
  local: Map<string, string>;
} {
  const conversation = params?.conversation ?? new Map<string, string>();
  const local = params?.local ?? new Map<string, string>();
  vi.stubGlobal("conversationStorage", createStorageMock(conversation));
  vi.stubGlobal("localStorage", createStorageMock(local));
  return { conversation, local };
}

export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }

  return { promise, resolve, reject };
}
