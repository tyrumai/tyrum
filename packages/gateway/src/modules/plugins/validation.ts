import { isAbsolute, relative, resolve } from "node:path";

export const REQUIRED_MANIFEST_FIELDS = [
  "id",
  "name",
  "version",
  "entry",
  "contributes",
  "permissions",
  "config_schema",
] as const;

export function missingRequiredManifestFields(value: Record<string, unknown>): string[] {
  return REQUIRED_MANIFEST_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
}

export function resolveSafeChildPath(parent: string, child: string): string {
  const absParent = resolve(parent);
  const absChild = resolve(absParent, child);
  const rel = relative(absParent, absChild);
  if (rel === "") return absChild;
  if (isAbsolute(rel)) throw new Error(`path escapes plugin directory: ${child}`);
  const firstSegment = rel.split(/[\\/]/g)[0];
  if (firstSegment === "..") throw new Error(`path escapes plugin directory: ${child}`);
  return absChild;
}
