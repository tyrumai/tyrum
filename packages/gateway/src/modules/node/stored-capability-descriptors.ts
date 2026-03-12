import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor as CapabilityDescriptorSchema,
  ClientCapability,
  capabilityDescriptorsForClientCapability,
  normalizeCapabilityDescriptors,
} from "@tyrum/schemas";
import type { CapabilityDescriptor } from "@tyrum/schemas";

function parseStoredCapabilityString(value: string): CapabilityDescriptor[] {
  const legacyCapability = ClientCapability.safeParse(value);
  if (legacyCapability.success) {
    return capabilityDescriptorsForClientCapability(legacyCapability.data);
  }

  const descriptor = CapabilityDescriptorSchema.safeParse({
    id: value,
    version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  });
  return descriptor.success ? [descriptor.data] : [];
}

export function parseStoredCapabilityDescriptors(value: unknown): CapabilityDescriptor[] {
  if (!Array.isArray(value)) return [];

  const descriptors = value.flatMap((entry) => {
    if (typeof entry === "string") {
      return parseStoredCapabilityString(entry);
    }

    const descriptor = CapabilityDescriptorSchema.safeParse(entry);
    return descriptor.success ? [descriptor.data] : [];
  });

  return normalizeCapabilityDescriptors(descriptors);
}
