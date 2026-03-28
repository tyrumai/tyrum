export const READ_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "Use read when you already know the path you need to inspect.",
    "Use offset and limit for large files instead of reading the whole file at once.",
  ],
  promptExamples: [
    '{"path":"packages/gateway/src/modules/agent/runtime/preturn-hydration.ts","offset":0,"limit":120}',
  ],
} as const;

export const WRITE_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "write replaces the entire file contents, so use it only when you intend to create or fully rewrite the file.",
    "Prefer edit or apply_patch for smaller surgical changes to existing files.",
  ],
  promptExamples: ['{"path":"notes/summary.md","content":"Updated summary\\n"}'],
} as const;

export const EDIT_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "old_string must match the existing file text exactly.",
    "Use replace_all only when every matching occurrence should change.",
  ],
  promptExamples: [
    '{"path":"src/app.ts","old_string":"const enabled = false;","new_string":"const enabled = true;"}',
  ],
} as const;

export const APPLY_PATCH_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "Use apply_patch for multi-hunk or multi-file edits when exact string replacement is awkward.",
    "The patch field must use the Codex *** Begin Patch format exactly.",
  ],
  promptExamples: [
    '{"patch":"*** Begin Patch\\n*** Update File: src/app.ts\\n@@\\n-old\\n+new\\n*** End Patch"}',
  ],
} as const;

export const BASH_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "Prefer one bounded command at a time and set cwd when the command is workspace-specific.",
    "Avoid interactive commands, shell prompts, or background daemons that will not exit cleanly.",
  ],
  promptExamples: ['{"command":"pnpm lint","cwd":"packages/gateway","timeout_ms":120000}'],
} as const;

export const GLOB_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "Use glob to discover candidate paths before read, edit, or apply_patch.",
    "Keep the pattern narrow so follow-up reads stay bounded.",
  ],
  promptExamples: ['{"pattern":"**/*guardian*.ts","path":"packages/gateway/src/modules"}'],
} as const;

export const GREP_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "Use grep when you know the text or regex to search for but not the exact file.",
    "Combine path and include filters to keep the result set focused.",
  ],
  promptExamples: [
    '{"pattern":"buildGuardianReviewSystemPrompt","path":"packages/gateway/src/modules","include":"*.ts"}',
  ],
} as const;

export const TOOL_NODE_LIST_PROMPT_METADATA = {
  promptGuidance: [
    "Call tool.node.list with no filters first when you need to see all nodes and capability summary status.",
    "Use exact capability descriptor ids only when filtering. Omit capability to list all nodes; wildcard filters are not supported.",
    "Use node device metadata and attached_to_requested_conversation to choose the best node for an action. Prefer nodes the user is actively using.",
  ],
  promptExamples: [
    "{}",
    '{"capability":"tyrum.browser.navigate","dispatchable_only":true}',
    '{"capability":"tyrum.location.get","dispatchable_only":true}',
  ],
} as const;

export const TOOL_NODE_CAPABILITY_GET_PROMPT_METADATA = {
  promptGuidance: [
    "Use this after tool.node.list when you need action-level availability, input schema, or consent/permission detail for one capability on one node.",
  ],
  promptExamples: [
    '{"node_id":"node_123","capability":"tyrum.browser.navigate"}',
    '{"node_id":"node_456","capability":"tyrum.camera.capture-photo"}',
  ],
} as const;

export const AUTOMATION_SCHEDULE_CREATE_PROMPT_METADATA = {
  promptGuidance: [
    "Use explicit cadence and execution objects instead of describing the schedule in prose.",
    "Set delivery.mode deliberately when the run should notify operators instead of staying quiet.",
  ],
  promptExamples: [
    '{"kind":"heartbeat","cadence":{"type":"interval","interval_ms":3600000},"execution":{"kind":"agent_turn","instruction":"Review workboard state for stalled tasks."},"delivery":{"mode":"notify"}}',
  ],
} as const;

export const AUTOMATION_SCHEDULE_UPDATE_PROMPT_METADATA = {
  promptGuidance: [
    "Use schedule.list or schedule.get first so you patch the correct schedule_id.",
    "Only include the fields you intend to change; omitted fields keep their current values.",
  ],
  promptExamples: [
    '{"schedule_id":"schedule_123","cadence":{"type":"cron","expression":"0 9 * * 1-5","timezone":"Europe/Amsterdam"},"delivery":{"mode":"quiet"}}',
  ],
} as const;

export const LOCATION_PLACE_CREATE_PROMPT_METADATA = {
  promptGuidance: [
    "Create saved places with exact coordinates and a deliberate radius_m in meters.",
    "Omit agent_key to use the current agent scope, or set it explicitly when managing another agent's places.",
  ],
  promptExamples: [
    '{"name":"Home","latitude":52.3676,"longitude":4.9041,"radius_m":100,"tags":["home"],"source":"manual"}',
  ],
} as const;

export const LOCATION_PLACE_UPDATE_PROMPT_METADATA = {
  promptGuidance: [
    "Use place.list first so you patch the correct place_id.",
    "Only include the fields you intend to change; omitted fields keep their current values.",
  ],
  promptExamples: [
    '{"place_id":"123e4567-e89b-12d3-a456-426614174000","name":"Home Base","radius_m":150}',
  ],
} as const;

export const ARTIFACT_DESCRIBE_TOOL_PROMPT_METADATA = {
  promptGuidance: [
    "Use artifact.describe when a prior tool call or message produced an artifact id and you need to inspect that file in the same turn.",
    "Pass prompt when you need focused extraction instead of a general description.",
  ],
  promptExamples: [
    '{"artifact_id":"123e4567-e89b-12d3-a456-426614174000","prompt":"Extract the visible error message."}',
  ],
} as const;
