import * as React from "react";

export type ApiActionState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; value: T }
  | { status: "error"; error: unknown };

export function useApiAction<T>() {
  const mountedRef = React.useRef(true);
  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [state, setState] = React.useState<ApiActionState<T>>({ status: "idle" });

  const runInternal = React.useCallback(
    async (
      action: () => Promise<T>,
      options?: { throwOnError?: boolean; throwOnInFlight?: boolean },
    ): Promise<T | undefined> => {
      if (inFlightRef.current) {
        if (options?.throwOnInFlight) {
          throw new Error("Request already in progress");
        }
        return undefined;
      }
      inFlightRef.current = true;
      setState({ status: "loading" });
      try {
        const value = await action();
        if (mountedRef.current) setState({ status: "success", value });
        return value;
      } catch (error) {
        if (mountedRef.current) setState({ status: "error", error });
        if (options?.throwOnError) throw error;
        return undefined;
      } finally {
        inFlightRef.current = false;
      }
    },
    [],
  );

  const run = React.useCallback(
    async (
      action: () => Promise<T>,
      options?: { throwOnError?: boolean },
    ): Promise<T | undefined> => await runInternal(action, options),
    [runInternal],
  );

  const runAndThrow = React.useCallback(
    async (action: () => Promise<T>): Promise<T> => {
      const value = await runInternal(action, { throwOnError: true, throwOnInFlight: true });
      if (typeof value === "undefined") throw new Error("Unreachable");
      return value;
    },
    [runInternal],
  );

  const reset = React.useCallback(() => {
    if (mountedRef.current) setState({ status: "idle" });
  }, []);

  return {
    state,
    isLoading: state.status === "loading",
    value: state.status === "success" ? state.value : undefined,
    error: state.status === "error" ? state.error : undefined,
    run,
    runAndThrow,
    reset,
  };
}
