import type {
  MemoryDeletedBy,
  MemoryItem,
  MemoryItemKind,
  MemorySensitivity,
} from "@tyrum/contracts";
import type { BadgeVariant } from "../ui/badge.js";

export type MemoryTab = "items" | "tombstones";

export function memoryKindLabel(kind: MemoryItemKind): string {
  switch (kind) {
    case "fact":
      return "Fact";
    case "note":
      return "Note";
    case "procedure":
      return "Procedure";
    case "episode":
      return "Episode";
  }
}

export function memoryKindBadgeVariant(kind: MemoryItemKind): BadgeVariant {
  switch (kind) {
    case "fact":
      return "default";
    case "note":
      return "success";
    case "procedure":
      return "outline";
    case "episode":
      return "warning";
  }
}

export function memorySensitivityBadgeVariant(sensitivity: MemorySensitivity): BadgeVariant {
  switch (sensitivity) {
    case "public":
      return "default";
    case "private":
      return "outline";
    case "sensitive":
      return "warning";
  }
}

export function memoryDeletedByLabel(deletedBy: MemoryDeletedBy): string {
  switch (deletedBy) {
    case "user":
      return "User";
    case "operator":
      return "Operator";
    case "system":
      return "System";
    case "budget":
      return "Budget";
    case "consolidation":
      return "Consolidation";
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return truncate(value, 80);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), 80);
  } catch {
    return "[complex value]";
  }
}

export function memoryItemSummary(item: MemoryItem): string {
  switch (item.kind) {
    case "fact":
      return `${item.key} = ${previewValue(item.value)}`;
    case "note":
      return item.title ?? truncate(item.body_md.split("\n")[0] ?? "", 100);
    case "procedure":
      return item.title ?? truncate(item.body_md.split("\n")[0] ?? "", 100);
    case "episode":
      return truncate(item.summary_md.split("\n")[0] ?? "", 100);
  }
}

export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}
