export function toolIdForCapabilityDescriptor(capabilityId: string): string {
  const normalized = capabilityId.trim();
  if (!normalized.startsWith("tyrum.")) {
    throw new Error(`unsupported capability descriptor id: ${capabilityId}`);
  }
  return `tool.${normalized.slice("tyrum.".length)}`;
}
