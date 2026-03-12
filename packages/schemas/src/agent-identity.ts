import { z } from "zod";

function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stripLegacyIdentityFields(value: unknown): unknown {
  const parsed = asPlainObject(value);
  if (!parsed) return value;

  const meta = asPlainObject(parsed["meta"]);
  const style = asPlainObject(meta?.["style"]);
  return {
    meta: {
      name: meta?.["name"],
      ...(style?.["tone"] ? { style: { tone: style["tone"] } } : {}),
    },
  };
}

export const IdentityStyle = z.object({
  tone: z.string().trim().min(1).optional(),
});
export type IdentityStyle = z.infer<typeof IdentityStyle>;

export const IdentityFrontmatter = z.object({
  name: z.string().trim().min(1),
  style: IdentityStyle.optional(),
});
export type IdentityFrontmatter = z.infer<typeof IdentityFrontmatter>;

export const IdentityPack = z.preprocess(
  stripLegacyIdentityFields,
  z
    .object({
      meta: IdentityFrontmatter,
    })
    .strict(),
);
export type IdentityPack = z.infer<typeof IdentityPack>;
