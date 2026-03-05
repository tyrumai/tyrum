import { randomUUID } from "node:crypto";

export function slugifyKey(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

export function createUniqueKey(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base}-${String(index)}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}
