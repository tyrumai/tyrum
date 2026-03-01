import * as React from "react";
import { Textarea, type TextareaProps } from "./textarea.js";

function parseJsonInput(rawValue: string): {
  value: unknown | undefined;
  errorMessage: string | null;
} {
  const trimmed = rawValue.trim();
  if (!trimmed) return { value: undefined, errorMessage: null };

  try {
    return { value: JSON.parse(trimmed) as unknown, errorMessage: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: undefined, errorMessage: message };
  }
}

export interface JsonTextareaProps extends TextareaProps {
  onJsonChange?: (value: unknown | undefined, errorMessage: string | null) => void;
}

export function JsonTextarea({
  value,
  onJsonChange,
  helperText,
  error,
  ...props
}: JsonTextareaProps): React.ReactElement {
  const rawValue = typeof value === "string" ? value : "";
  const parsed = React.useMemo(() => parseJsonInput(rawValue), [rawValue]);

  React.useEffect(() => {
    onJsonChange?.(parsed.value, parsed.errorMessage);
  }, [onJsonChange, parsed.errorMessage, parsed.value]);

  const resolvedError =
    parsed.errorMessage !== null ? `Invalid JSON: ${parsed.errorMessage}` : error;

  const resolvedHelperText =
    parsed.errorMessage === null && rawValue.trim() ? (helperText ?? "Valid JSON") : helperText;

  return (
    <Textarea
      value={value}
      helperText={resolvedHelperText}
      error={resolvedError}
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      {...props}
    />
  );
}
