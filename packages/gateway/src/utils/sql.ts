export function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
