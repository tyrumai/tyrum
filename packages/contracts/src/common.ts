import { z } from "zod";

/** ISO-8601 datetime string. */
export const DateTimeSchema = z.string().datetime();

/** UUID as text (SQLite-compatible). */
export const UuidSchema = z.string().uuid();
