function slugifyChannelAccountName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function createUniqueChannelAccountName(input: {
  preferredName: string;
  fallbackName: string;
  existingAccountKeys: readonly string[];
  excludeAccountKey?: string | null;
}): string {
  const fallback = slugifyChannelAccountName(input.fallbackName) || "account";
  const base = slugifyChannelAccountName(input.preferredName) || fallback;
  const excluded = input.excludeAccountKey?.trim().toLowerCase();
  const existing = new Set(
    input.existingAccountKeys
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0 && value !== excluded),
  );

  if (!existing.has(base)) {
    return base;
  }

  let index = 2;
  while (existing.has(`${base}-${String(index)}`)) {
    index += 1;
  }
  return `${base}-${String(index)}`;
}
