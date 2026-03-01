import * as React from "react";

export type ApiActionState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; value: T }
  | { status: "error"; error: unknown };

export function useApiAction<T>() {
  const [state, setState] = React.useState<ApiActionState<T>>({ status: "idle" });

  const run = React.useCallback(
    async (
      action: () => Promise<T>,
      options?: { throwOnError?: boolean },
    ): Promise<T | undefined> => {
      setState({ status: "loading" });
      try {
        const value = await action();
        setState({ status: "success", value });
        return value;
      } catch (error) {
        setState({ status: "error", error });
        if (options?.throwOnError) throw error;
        return undefined;
      }
    },
    [],
  );

  const reset = React.useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return {
    state,
    isLoading: state.status === "loading",
    value: state.status === "success" ? state.value : undefined,
    error: state.status === "error" ? state.error : undefined,
    run,
    reset,
  };
}

export function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
