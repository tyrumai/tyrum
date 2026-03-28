export {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CAPABILITY_DESCRIPTOR_IDS,
  LEGACY_UMBRELLA_PLATFORM_DESCRIPTOR_IDS,
  CapabilityDescriptor,
  CapabilityKind,
  ClientCapability,
  capabilityDescriptorsForClientCapability,
  clientCapabilityFromDescriptorId,
  descriptorIdForClientCapability,
  descriptorIdsForClientCapability,
  expandCapabilityDescriptorId,
  isLegacyUmbrellaCapabilityDescriptorId,
  normalizeCapabilityDescriptors,
} from "./capability.js";

// NOTE: `export *` makes every exported symbol in submodules part of the public API.
// Keep submodules limited to intended public exports only.
export * from "./protocol/approvals.js";
export * from "./protocol/capability-ready.js";
export * from "./protocol/chat-events.js";
export * from "./protocol/chat-conversation.js";
export * from "./protocol/connect.js";
export * from "./protocol/command-execute.js";
export * from "./protocol/envelopes.js";
export * from "./protocol/execution.js";
export * from "./protocol/execution-events.js";
export * from "./protocol/location.js";
export * from "./protocol/pairing.js";
export * from "./protocol/presence.js";
export * from "./protocol/subagent.js";
export * from "./protocol/transcript.js";
export * from "./protocol/work.js";
export * from "./protocol/work-drilldown.js";
export * from "./protocol/unions.js";
export * from "./protocol/unions-response.js";
export * from "./protocol/workflow.js";
