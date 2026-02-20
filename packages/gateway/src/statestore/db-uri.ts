export function isPostgresDbUri(dbPath: string): boolean {
  return /^postgres(ql)?:\/\//i.test(dbPath.trim());
}
