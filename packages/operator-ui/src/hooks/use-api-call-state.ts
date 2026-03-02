import { useCallback, useEffect, useRef, useState } from "react";

export type ApiCallState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; value: unknown }
  | { status: "error"; error: unknown };

export function useApiCallState(): {
  state: ApiCallState;
  run: (request: () => Promise<unknown>) => Promise<void>;
  runAndThrow: <T>(request: () => Promise<T>) => Promise<T>;
  fail: (error: unknown) => void;
} {
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [state, setState] = useState<ApiCallState>({ status: "idle" });

  const fail = useCallback((error: unknown): void => {
    if (!mountedRef.current) return;
    setState({ status: "error", error });
  }, []);

  const run = useCallback(async (request: () => Promise<unknown>): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ status: "loading" });
    try {
      const value = await request();
      if (!mountedRef.current) return;
      setState({ status: "success", value });
    } catch (error) {
      if (!mountedRef.current) return;
      setState({ status: "error", error });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const runAndThrow = useCallback(async <T>(request: () => Promise<T>): Promise<T> => {
    if (inFlightRef.current) throw new Error("Request already in progress");
    inFlightRef.current = true;
    setState({ status: "loading" });
    try {
      const value = await request();
      if (mountedRef.current) setState({ status: "success", value });
      return value;
    } catch (error) {
      if (mountedRef.current) setState({ status: "error", error });
      throw error;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  return { state, run, runAndThrow, fail };
}
