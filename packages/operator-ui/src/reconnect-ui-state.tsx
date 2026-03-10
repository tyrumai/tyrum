import { ScrollArea } from "./components/ui/scroll-area.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ElementRef,
  type ReactNode,
  type RefCallback,
  type SetStateAction,
} from "react";

type RetainedUiStateStore = {
  scopeKey: string;
  getTab(key: string): string | null;
  setTab(key: string, value: string): void;
  getScroll(key: string): number | null;
  setScroll(key: string, value: number): void;
};

const RetainedUiStateContext = createContext<RetainedUiStateStore | null>(null);
type FrameHandle = number | ReturnType<typeof globalThis.setTimeout>;

function scheduleFrame(callback: () => void): FrameHandle {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 0);
}

function cancelFrame(frameId: FrameHandle): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(frameId as number);
    return;
  }
  globalThis.clearTimeout(frameId);
}

function resolveViewport(rootNode: ElementRef<typeof ScrollArea> | null): HTMLElement | null {
  if (!(rootNode instanceof HTMLElement)) return null;
  return rootNode.querySelector<HTMLElement>("[data-scroll-area-viewport]");
}

function useRetainedUiStateStore(): RetainedUiStateStore {
  const value = useContext(RetainedUiStateContext);
  if (!value) {
    throw new Error("Reconnect UI state hooks must be used inside RetainedUiStateProvider.");
  }
  return value;
}

export function RetainedUiStateProvider({
  scopeKey,
  children,
}: {
  scopeKey: string;
  children: ReactNode;
}) {
  const tabsRef = useRef<Record<string, string>>({});
  const scrollRef = useRef<Record<string, number>>({});
  const scopeKeyRef = useRef(scopeKey);

  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    tabsRef.current = {};
    scrollRef.current = {};
  }

  const value = useMemo<RetainedUiStateStore>(
    () => ({
      scopeKey,
      getTab(key) {
        return tabsRef.current[key] ?? null;
      },
      setTab(key, nextTabValue) {
        tabsRef.current[key] = nextTabValue;
      },
      getScroll(key) {
        return scrollRef.current[key] ?? null;
      },
      setScroll(key, nextScrollValue) {
        scrollRef.current[key] = nextScrollValue;
      },
    }),
    [scopeKey],
  );

  return (
    <RetainedUiStateContext.Provider value={value}>{children}</RetainedUiStateContext.Provider>
  );
}

export function useReconnectTabState<T extends string>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const store = useRetainedUiStateStore();
  const [value, setValue] = useState<T>(() => (store.getTab(key) as T | null) ?? defaultValue);

  useEffect(() => {
    setValue((store.getTab(key) as T | null) ?? defaultValue);
  }, [defaultValue, key, store, store.scopeKey]);

  const setRetainedValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      setValue((previousValue) => {
        const resolved =
          typeof nextValue === "function"
            ? (nextValue as (previousValue: T) => T)(previousValue)
            : nextValue;
        store.setTab(key, resolved);
        return resolved;
      });
    },
    [key, store],
  );

  return [value, setRetainedValue];
}

export function useReconnectScrollArea(key: string): RefCallback<ElementRef<typeof ScrollArea>> {
  const store = useRetainedUiStateStore();
  const [rootNode, setRootNode] = useState<ElementRef<typeof ScrollArea> | null>(null);

  useLayoutEffect(() => {
    const viewport = resolveViewport(rootNode);
    if (!viewport) return;

    const restoreScroll = (): void => {
      const savedScrollTop = store.getScroll(key);
      if (savedScrollTop === null) return;
      viewport.scrollTop = savedScrollTop;
    };

    restoreScroll();
    const frameId = scheduleFrame(restoreScroll);
    const handleScroll = (): void => {
      store.setScroll(key, viewport.scrollTop);
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelFrame(frameId);
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [key, rootNode, store, store.scopeKey]);

  return useCallback((node: ElementRef<typeof ScrollArea> | null) => {
    setRootNode(node);
  }, []);
}
