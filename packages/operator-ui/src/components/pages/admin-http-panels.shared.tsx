import * as React from "react";
import { JsonTextarea, type JsonTextareaProps } from "../ui/json-textarea.js";

export type ApiResultState = {
  heading: string;
  value: unknown | undefined;
  error: unknown | undefined;
  busy: boolean;
};

export type ApiRunOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

export type ApiRunner = (heading: string, fn: () => Promise<unknown>) => Promise<ApiRunOutcome>;

export function useApiResultState(initialHeading: string): {
  state: ApiResultState;
  run: ApiRunner;
} {
  const [state, setState] = React.useState<ApiResultState>({
    heading: initialHeading,
    value: undefined,
    error: undefined,
    busy: false,
  });

  const run = React.useCallback<ApiRunner>(async (heading, fn) => {
    setState((prev) => ({ ...prev, heading, busy: true, error: undefined }));
    try {
      const value = await fn();
      setState((prev) => ({ ...prev, value, busy: false }));
      return { ok: true, value };
    } catch (error) {
      setState((prev) => ({ ...prev, error, value: undefined, busy: false }));
      return { ok: false, error };
    }
  }, []);

  return { state, run };
}

export type JsonInputState = {
  raw: string;
  setRaw: (next: string) => void;
  value: unknown | undefined;
  errorMessage: string | null;
  setValue: (next: unknown | undefined) => void;
  setErrorMessage: (next: string | null) => void;
};

export function useJsonInputState(initialValue: string): JsonInputState {
  const [raw, setRaw] = React.useState(initialValue);
  const [value, setValue] = React.useState<unknown | undefined>(undefined);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  return { raw, setRaw, value, errorMessage, setValue, setErrorMessage };
}

export function JsonInput({
  state,
  ...props
}: Omit<JsonTextareaProps, "value" | "onChange" | "onJsonChange"> & {
  state: JsonInputState;
}): React.ReactElement {
  return (
    <JsonTextarea
      value={state.raw}
      onChange={(event) => {
        state.setRaw(event.target.value);
      }}
      onJsonChange={(value, errorMessage) => {
        state.setValue(value);
        state.setErrorMessage(errorMessage);
      }}
      {...props}
    />
  );
}

export function resolveJsonValue(
  input: { value: unknown | undefined },
  fallback: unknown,
): unknown {
  if (typeof input.value === "undefined") return fallback;
  return input.value;
}

export type PendingMutation = {
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  confirmationLabel?: React.ReactNode;
  content?: React.ReactNode;
  onConfirm: () => Promise<void>;
};

export type OpenMutation = (mutation: PendingMutation) => void;
