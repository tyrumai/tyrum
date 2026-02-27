export {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor,
  ClientCapability,
  clientCapabilityFromDescriptorId,
  descriptorIdForClientCapability,
} from "./capability.js";

// NOTE: `export *` makes every exported symbol in submodules part of the public API.
// Keep submodules limited to intended public exports only.
export * from "./protocol/approvals.js";
export * from "./protocol/capability-ready.js";
export * from "./protocol/connect.js";
export * from "./protocol/envelopes.js";
export * from "./protocol/execution.js";
export * from "./protocol/memory.js";
export * from "./protocol/pairing.js";
export * from "./protocol/presence.js";
export * from "./protocol/session.js";
export * from "./protocol/subagent.js";
export * from "./protocol/work.js";
export * from "./protocol/unions.js";
export * from "./protocol/workflow.js";
