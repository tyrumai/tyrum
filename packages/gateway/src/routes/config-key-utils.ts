import { randomUUID } from "node:crypto";
import { AgentKey } from "@tyrum/schemas";

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

export function normalizeAgentKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "default";
  const parsed = AgentKey.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`invalid agent_key '${trimmed}' (${parsed.error.message})`);
  }
  return parsed.data;
}
