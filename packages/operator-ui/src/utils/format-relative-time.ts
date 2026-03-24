import { formatSharedMessage, getDocumentLocale } from "../i18n/messages.js";

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const timestampMs = Date.parse(iso);
  if (!Number.isFinite(timestampMs)) return "";

  const deltaSeconds = Math.floor((nowMs - timestampMs) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  const locale = getDocumentLocale();

  if (absSeconds < 10) return formatSharedMessage("just now", undefined, locale);
  const format = (value: number, unit: "s" | "m" | "h" | "d") =>
    formatSharedMessage(
      deltaSeconds < 0 ? `in {value}${unit}` : `{value}${unit} ago`,
      { value },
      locale,
    );
  if (absSeconds < 60) return format(absSeconds, "s");
  const absMinutes = Math.floor(absSeconds / 60);
  if (absMinutes < 60) return format(absMinutes, "m");
  const absHours = Math.floor(absMinutes / 60);
  if (absHours < 24) return format(absHours, "h");
  const absDays = Math.floor(absHours / 24);
  return format(absDays, "d");
}
