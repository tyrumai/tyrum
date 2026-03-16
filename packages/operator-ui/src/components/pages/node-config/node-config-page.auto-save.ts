import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "./node-config-page.types.js";

const SAVED_DISPLAY_MS = 2_000;

export interface UseAutoSaveOptions<T> {
  /** Current value to persist. */
  value: T;
  /** Async persist function. Called with the latest value. */
  persist: (value: T) => Promise<void>;
  /** Debounce delay in ms. 0 = immediate on change. */
  debounceMs: number;
  /** Equality check (defaults to ===). */
  isEqual?: (a: T, b: T) => boolean;
  /** Whether auto-save is active. Pass false to disable (e.g. while loading). */
  enabled?: boolean;
}

export interface AutoSaveResult {
  status: SaveStatus;
  errorMessage: string | null;
  /** Force an immediate persist (e.g. on blur). */
  flush: () => void;
}

/**
 * Auto-saves a value whenever it changes, with optional debounce.
 *
 * - `debounceMs: 0` persists on every change (for toggles).
 * - `debounceMs: 500` waits for typing to settle (for text fields).
 * - Coalesces rapid changes: always persists the latest value.
 * - Status cycle: idle → saving → saved (2s) → idle, or → error.
 */
export function useAutoSave<T>(options: UseAutoSaveOptions<T>): AutoSaveResult {
  const { value, persist, debounceMs, isEqual = defaultIsEqual, enabled = true } = options;

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const valueRef = useRef(value);
  valueRef.current = value;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const lastPersistedRef = useRef(value);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const doPersist = useCallback(async () => {
    if (savingRef.current) return;

    const currentValue = valueRef.current;
    if (isEqualRef.current(currentValue, lastPersistedRef.current)) return;

    savingRef.current = true;
    if (mountedRef.current) {
      setStatus("saving");
      setErrorMessage(null);
    }

    try {
      await persistRef.current(currentValue);
      lastPersistedRef.current = currentValue;

      if (!mountedRef.current) return;
      setStatus("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setStatus("idle");
        savedTimerRef.current = null;
      }, SAVED_DISPLAY_MS);

      // If value changed while saving, schedule another persist.
      if (!isEqualRef.current(valueRef.current, currentValue)) {
        savingRef.current = false;
        void doPersist();
        return;
      }
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      savingRef.current = false;
    }
  }, []);

  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void doPersist();
  }, [doPersist]);

  // Watch value changes and schedule persist.
  useEffect(() => {
    if (!enabled) return;
    if (isEqualRef.current(value, lastPersistedRef.current)) return;

    if (debounceMs <= 0) {
      void doPersist();
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void doPersist();
    }, debounceMs);
  }, [value, debounceMs, doPersist, enabled]);

  return { status, errorMessage, flush };
}

function defaultIsEqual<T>(a: T, b: T): boolean {
  return a === b;
}
