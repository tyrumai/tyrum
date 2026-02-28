export const MIGRATION_FILENAME_RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  ["019_node_pairing_trust_allowlist.sql", "020_node_pairing_trust_allowlist.sql"],
  ["020_execution_attempt_policy.sql", "021_execution_attempt_policy.sql"],
  ["020_peer_identity_links.sql", "022_peer_identity_links.sql"],
  ["021_channel_inbound_dedupe.sql", "023_channel_inbound_dedupe.sql"],
  ["021_execution_artifact_lifecycle.sql", "024_execution_artifact_lifecycle.sql"],
  ["021_node_pairing_scoped_tokens.sql", "025_node_pairing_scoped_tokens.sql"],
  ["022_connection_directory_readiness.sql", "026_connection_directory_readiness.sql"],
  ["022_lane_queue_modes.sql", "027_lane_queue_modes.sql"],
  ["023_session_model_overrides.sql", "028_session_model_overrides.sql"],
  ["023_session_provider_pins_session_id_idx.sql", "029_session_provider_pins_session_id_idx.sql"],
  ["024_lane_queue_mode_overrides.sql", "030_lane_queue_mode_overrides.sql"],
  ["024_routing_configs.sql", "031_routing_configs.sql"],
  ["025_session_send_policy_overrides.sql", "032_session_send_policy_overrides.sql"],
  ["026_workboard_persistence.sql", "033_workboard_persistence.sql"],
  ["027_memory_v1_persistence.sql", "034_memory_v1_persistence.sql"],
  ["028_work_signal_firings.sql", "035_work_signal_firings.sql"],
  ["028_workboard_task_leases.sql", "036_workboard_task_leases.sql"],
  ["029_intake_mode_overrides.sql", "037_intake_mode_overrides.sql"],
];

export function getMigrationAliasesToMarkApplied(applied: ReadonlySet<string>): string[] {
  const aliases: string[] = [];
  for (const [from, to] of MIGRATION_FILENAME_RENAMES) {
    if (!applied.has(from)) continue;
    if (applied.has(to)) continue;
    aliases.push(to);
  }
  return aliases;
}
