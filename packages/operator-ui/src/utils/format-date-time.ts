import { getDocumentLocale } from "../i18n/messages.js";

const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

export function formatDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_OPTIONS,
  locales?: string | readonly string[],
): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const date =
    value instanceof Date ? value : typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }

  return new Intl.DateTimeFormat(locales ?? getDocumentLocale(), options).format(date);
}
