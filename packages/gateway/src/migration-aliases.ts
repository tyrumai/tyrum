export const MIGRATION_FILENAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "103_vector_metadata_pk.sql": ["102_vector_metadata_pk.sql"],
  "104_channel_outbox_tenant_inbox_fk.sql": ["102_channel_outbox_tenant_inbox_fk.sql"],
};

export function findAppliedMigrationAlias(
  file: string,
  applied: ReadonlySet<string>,
): string | undefined {
  const aliases = MIGRATION_FILENAME_ALIASES[file];
  if (!aliases) return undefined;
  return aliases.find((alias) => applied.has(alias));
}
