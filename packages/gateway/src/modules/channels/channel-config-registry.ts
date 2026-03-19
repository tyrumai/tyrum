export {
  ChannelValidationError,
  type ChannelRegistrySpec,
} from "./channel-config-registry-shared.js";

import type { ChannelRegistryEntry as ChannelRegistryEntryT } from "@tyrum/contracts";
import { discordSpec } from "./channel-config-registry-discord.js";
import { googleChatSpec } from "./channel-config-registry-googlechat.js";
import { telegramSpec } from "./channel-config-registry-telegram.js";

const registrySpecs = [telegramSpec, discordSpec, googleChatSpec] as const;

export function listChannelRegistrySpecs() {
  return [...registrySpecs];
}

export function listChannelRegistryEntries(): ChannelRegistryEntryT[] {
  return registrySpecs.map((spec) => spec.entry);
}

export function getChannelRegistrySpec(channel: string) {
  return registrySpecs.find((spec) => spec.entry.channel === channel);
}
