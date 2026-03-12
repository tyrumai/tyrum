export const MIGRATION_FILENAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "103_vector_metadata_pk.sql": ["102_vector_metadata_pk.sql"],
  "104_channel_outbox_tenant_inbox_fk.sql": ["102_channel_outbox_tenant_inbox_fk.sql"],
  "106_db_config_and_tokens.sql": [
    "102_db_config_and_tokens.sql",
    "104_db_config_and_tokens.sql",
    "105_db_config_and_tokens.sql",
  ],
  "107_db_config_and_tokens_indexes.sql": [
    "103_db_config_and_tokens_indexes.sql",
    "105_db_config_and_tokens_indexes.sql",
    "106_db_config_and_tokens_indexes.sql",
  ],
  "109_default_tenant_guardrails.sql": ["108_default_tenant_guardrails.sql"],
  "110_approval_engine_actions.sql": [
    "106_approval_engine_actions.sql",
    "108_approval_engine_actions.sql",
    "109_approval_engine_actions.sql",
  ],
  "113_provider_model_config.sql": ["108_provider_model_config.sql"],
  "114_provider_model_config_indexes.sql": ["109_provider_model_config_indexes.sql"],
  "117_ws_events.sql": ["116_ws_events.sql"],
  "132_desktop_environments.sql": ["131_desktop_environments.sql"],
  "133_desktop_environment_boolean_columns.sql": ["132_desktop_environment_boolean_columns.sql"],
};

export function findAppliedMigrationAlias(
  file: string,
  applied: ReadonlySet<string>,
): string | undefined {
  const aliases = MIGRATION_FILENAME_ALIASES[file];
  if (!aliases) return undefined;
  return aliases.find((alias) => applied.has(alias));
}
