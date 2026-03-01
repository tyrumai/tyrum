export function parseJsonInput(rawValue: string): {
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
