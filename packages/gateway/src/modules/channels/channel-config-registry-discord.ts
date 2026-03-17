import { ChannelRegistryEntry } from "@tyrum/schemas";
import type { StoredDiscordChannelConfig } from "./channel-config-dal.js";
import {
  type ChannelRegistrySpec,
  configuredSecretKeysForConfig,
  field,
  fieldError,
  parseStringList,
  readRequiredSecret,
  readRequiredString,
  resolveSecretUpdate,
  toConfiguredChannelAccount,
  unique,
} from "./channel-config-registry-shared.js";

const DISCORD_TOKEN_HELP_LINES = [
  "1. Discord Developer Portal -> Applications -> New Application.",
  "2. Bot -> Add Bot -> Reset Token -> copy the bot token.",
  "3. OAuth2 -> URL Generator -> scope bot -> invite it to your server.",
  "4. Enable Message Content Intent if you need message text.",
];

function normalizeDiscordToken(token: string | undefined): string | undefined {
  if (!token?.trim()) {
    return undefined;
  }
  return token
    .trim()
    .replace(/^bot\s+/i, "")
    .trim();
}

function normalizeDiscordSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type DiscordGuildSummary = {
  id: string;
  name: string;
  slug: string;
};

class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchDiscord<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new DiscordApiError(text || `Discord API failed for ${path}`, response.status);
  }
  return (await response.json()) as T;
}

async function listDiscordGuilds(token: string): Promise<DiscordGuildSummary[]> {
  const raw = await fetchDiscord<Array<{ id?: string; name?: string }>>("/users/@me/guilds", token);
  return raw
    .filter(
      (guild): guild is { id: string; name: string } =>
        typeof guild.id === "string" && typeof guild.name === "string",
    )
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      slug: normalizeDiscordSlug(guild.name),
    }));
}

function parseDiscordUserInput(raw: string): {
  userId?: string;
  guildId?: string;
  guildName?: string;
  userName?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const mention = trimmed.match(/^<@!?(\d+)>$/);
  if (mention?.[1]) return { userId: mention[1] };
  const numeric = trimmed.match(/^(?:user:|discord:)?(\d+)$/i);
  if (numeric?.[1]) return { userId: numeric[1] };
  const split = trimmed.includes("/") ? trimmed.split("/") : trimmed.split("#");
  if (split.length >= 2) {
    const guild = split[0]?.trim();
    const user = split.slice(1).join("#").trim();
    if (guild && /^\d+$/.test(guild)) {
      return { guildId: guild, userName: user };
    }
    return { guildName: guild, userName: user };
  }
  return { userName: trimmed.replace(/^@/, "") };
}

function parseDiscordChannelInput(raw: string): {
  guild?: string;
  guildId?: string;
  channel?: string;
  channelId?: string;
  guildOnly?: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const mention = trimmed.match(/^<#(\d+)>$/);
  if (mention?.[1]) return { channelId: mention[1] };
  if (/^guild:[^/\s]+(?:\/channel:[^/\s]+)?$/i.test(trimmed)) {
    const match = trimmed.match(/^guild:([^/\s]+)(?:\/channel:([^/\s]+))?$/i);
    return {
      guildId: match?.[1],
      channelId: match?.[2],
      guildOnly: !match?.[2],
    };
  }
  const channelNumeric = trimmed.match(/^(?:channel:|discord:)?(\d+)$/i);
  if (channelNumeric?.[1]) return { channelId: channelNumeric[1] };
  const guildNumeric = trimmed.match(/^(?:guild:|server:)?(\d+)$/i);
  if (guildNumeric?.[1] && !trimmed.includes("/") && !trimmed.includes("#")) {
    return { guildId: guildNumeric[1], guildOnly: true };
  }
  const split = trimmed.includes("/") ? trimmed.split("/") : trimmed.split("#");
  if (split.length >= 2) {
    const guild = split[0]?.trim();
    const channel = split.slice(1).join("#").trim();
    if (guild && /^\d+$/.test(guild)) {
      return { guildId: guild, channel };
    }
    return { guild, channel };
  }
  return { guild: trimmed, guildOnly: true };
}

function findDiscordGuild(
  guilds: DiscordGuildSummary[],
  input: { guildId?: string; guildName?: string; guild?: string },
): DiscordGuildSummary | undefined {
  if (input.guildId) {
    return guilds.find((guild) => guild.id === input.guildId);
  }
  const rawName = input.guildName ?? input.guild;
  if (!rawName?.trim()) {
    return undefined;
  }
  const slug = normalizeDiscordSlug(rawName);
  return guilds.find((guild) => guild.slug === slug);
}

type DiscordMember = {
  user: {
    id: string;
    username: string;
    global_name?: string;
    bot?: boolean;
  };
  nick?: string | null;
};

function scoreDiscordMember(member: DiscordMember, query: string): number {
  const q = query.toLowerCase();
  const candidates = [member.user.username, member.user.global_name, member.nick ?? undefined]
    .map((value) => value?.toLowerCase())
    .filter(Boolean) as string[];
  let score = 0;
  if (candidates.some((value) => value === q)) score += 3;
  if (candidates.some((value) => value.includes(q))) score += 1;
  if (!member.user.bot) score += 1;
  return score;
}

async function resolveDiscordAllowedUsers(input: {
  entries: string[];
  token?: string;
  fieldKey: string;
}): Promise<string[]> {
  const token = normalizeDiscordToken(input.token);
  if (
    !token &&
    input.entries.some((entry) => !/^(?:<@!?\d+>|(?:user:|discord:)?\d+)$/i.test(entry.trim()))
  ) {
    throw fieldError(input.fieldKey, "Discord usernames require a bot token to resolve");
  }
  if (!token) {
    return unique(
      input.entries.map((entry) => {
        const parsed = parseDiscordUserInput(entry);
        if (!parsed.userId) {
          throw fieldError(input.fieldKey, `Unable to resolve Discord user '${entry}'`);
        }
        return parsed.userId;
      }),
    );
  }

  const guilds = await listDiscordGuilds(token);
  const resolved: string[] = [];
  for (const entry of input.entries) {
    const parsed = parseDiscordUserInput(entry);
    if (parsed.userId) {
      resolved.push(parsed.userId);
      continue;
    }
    const query = parsed.userName?.trim();
    if (!query) {
      throw fieldError(input.fieldKey, `Unable to resolve Discord user '${entry}'`);
    }
    const guildList =
      parsed.guildId || parsed.guildName ? [findDiscordGuild(guilds, parsed)] : guilds;
    let best: { id: string; score: number } | null = null;
    for (const guild of guildList) {
      if (!guild) continue;
      const params = new URLSearchParams({ query, limit: "25" });
      const members = await fetchDiscord<DiscordMember[]>(
        `/guilds/${guild.id}/members/search?${params.toString()}`,
        token,
      );
      for (const member of members) {
        const score = scoreDiscordMember(member, query);
        if (score <= 0) continue;
        if (!best || score > best.score) {
          best = { id: member.user.id, score };
        }
      }
    }
    if (!best) {
      throw fieldError(input.fieldKey, `Unable to resolve Discord user '${entry}'`);
    }
    resolved.push(best.id);
  }
  return unique(resolved);
}

type DiscordChannelPayload = {
  id?: string;
  name?: string;
  guild_id?: string;
  type?: number;
  thread_metadata?: { archived?: boolean };
};

async function listDiscordGuildChannels(
  token: string,
  guildId: string,
): Promise<DiscordChannelPayload[]> {
  return await fetchDiscord<DiscordChannelPayload[]>(`/guilds/${guildId}/channels`, token);
}

async function resolveDiscordAllowedChannels(input: {
  entries: string[];
  token?: string;
  fieldKey: string;
}): Promise<string[]> {
  const token = normalizeDiscordToken(input.token);
  if (!token) {
    for (const entry of input.entries) {
      if (!/^guild:[^/\s]+(?:\/channel:[^/\s]+)?$/i.test(entry.trim())) {
        throw fieldError(
          input.fieldKey,
          "Discord guild or channel labels require a bot token to resolve",
        );
      }
    }
    return unique(input.entries.map((entry) => entry.trim().toLowerCase()));
  }

  const guilds = await listDiscordGuilds(token);
  const resolved: string[] = [];
  for (const entry of input.entries) {
    const parsed = parseDiscordChannelInput(entry);
    if (parsed.guildId && parsed.channelId) {
      resolved.push(`guild:${parsed.guildId}/channel:${parsed.channelId}`);
      continue;
    }
    if (parsed.guildOnly && parsed.guildId) {
      resolved.push(`guild:${parsed.guildId}`);
      continue;
    }
    if (parsed.channelId) {
      const channel = await fetchDiscord<DiscordChannelPayload>(
        `/channels/${parsed.channelId}`,
        token,
      );
      if (typeof channel.guild_id !== "string" || typeof channel.id !== "string") {
        throw fieldError(input.fieldKey, `Unable to resolve Discord channel '${entry}'`);
      }
      resolved.push(`guild:${channel.guild_id}/channel:${channel.id}`);
      continue;
    }
    const guild = findDiscordGuild(guilds, parsed);
    if (!guild) {
      throw fieldError(input.fieldKey, `Unable to resolve Discord guild '${entry}'`);
    }
    if (parsed.guildOnly) {
      resolved.push(`guild:${guild.id}`);
      continue;
    }
    const channelQuery = parsed.channel?.trim();
    if (!channelQuery) {
      throw fieldError(input.fieldKey, `Unable to resolve Discord channel '${entry}'`);
    }
    const channels = await listDiscordGuildChannels(token, guild.id);
    const normalizedQuery = normalizeDiscordSlug(channelQuery);
    const match = channels.find((channel) => {
      if (typeof channel.id === "string" && channel.id === channelQuery) {
        return true;
      }
      return (
        typeof channel.name === "string" && normalizeDiscordSlug(channel.name) === normalizedQuery
      );
    });
    if (!match?.id) {
      throw fieldError(input.fieldKey, `Unable to resolve Discord channel '${entry}'`);
    }
    resolved.push(`guild:${guild.id}/channel:${match.id}`);
  }
  return unique(resolved);
}

export const discordSpec: ChannelRegistrySpec<StoredDiscordChannelConfig> = {
  entry: ChannelRegistryEntry.parse({
    channel: "discord",
    name: "Discord",
    doc: null,
    supported: true,
    configurable: true,
    intro_title: "Discord setup",
    intro_lines: [
      "Discord accounts can resolve DM usernames, guild names, and channel labels on save.",
      "Canonical guild/channel IDs are persisted after resolution.",
    ],
    fields: [
      field({
        key: "bot_token",
        label: "Bot token",
        description: "Required for Discord setup, resolution, and runtime access.",
        kind: "secret",
        input: "password",
        section: "credentials",
        required: true,
        help_title: "How to get a Discord bot token",
        help_lines: DISCORD_TOKEN_HELP_LINES,
      }),
      field({
        key: "allowed_user_ids",
        label: "Allowed Discord users",
        description:
          "Accepts user IDs, mentions, @usernames, or username#1234. Canonical user IDs are stored.",
        kind: "config",
        input: "textarea",
        section: "access",
        required: false,
        placeholder: "@alice, 123456789012345678",
      }),
      field({
        key: "allowed_channels",
        label: "Allowed Discord guilds or channels",
        description:
          "Accepts My Server/#general, guildId/channelId, or canonical guild/channel IDs.",
        kind: "config",
        input: "textarea",
        section: "access",
        required: false,
        placeholder: "My Server/#general, guild:123456/channel:987654",
      }),
      field({
        key: "agent_key",
        label: "Target agent",
        description: "All Discord messages for this account will go to this agent.",
        kind: "config",
        input: "select",
        section: "delivery",
        required: true,
        option_source: "agents",
      }),
    ],
  }),
  async create(input) {
    const botToken = readRequiredSecret(input.secrets, "bot_token", "Bot token");
    return {
      channel: "discord",
      account_key: input.accountKey,
      agent_key: readRequiredString(input.config, "agent_key", "Target agent"),
      bot_token: botToken,
      allowed_user_ids: await resolveDiscordAllowedUsers({
        entries: parseStringList(input.config["allowed_user_ids"]),
        token: botToken,
        fieldKey: "allowed_user_ids",
      }),
      allowed_channels: await resolveDiscordAllowedChannels({
        entries: parseStringList(input.config["allowed_channels"]),
        token: botToken,
        fieldKey: "allowed_channels",
      }),
    };
  },
  async update(input) {
    const botToken = resolveSecretUpdate({
      key: "bot_token",
      label: "Bot token",
      current: input.current.bot_token,
      secrets: input.secrets,
      clearSecretKeys: input.clearSecretKeys,
      required: true,
    });
    return {
      channel: "discord",
      account_key: input.current.account_key,
      agent_key: readRequiredString(input.config, "agent_key", "Target agent"),
      ...(botToken ? { bot_token: botToken } : {}),
      allowed_user_ids: await resolveDiscordAllowedUsers({
        entries: parseStringList(input.config["allowed_user_ids"]),
        token: botToken,
        fieldKey: "allowed_user_ids",
      }),
      allowed_channels: await resolveDiscordAllowedChannels({
        entries: parseStringList(input.config["allowed_channels"]),
        token: botToken,
        fieldKey: "allowed_channels",
      }),
    };
  },
  toConfiguredAccount(input) {
    return toConfiguredChannelAccount({
      channel: "discord",
      accountKey: input.config.account_key,
      config: {
        agent_key: input.config.agent_key,
        allowed_user_ids: input.config.allowed_user_ids,
        allowed_channels: input.config.allowed_channels,
      },
      configuredSecretKeys: configuredSecretKeysForConfig(input.config),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  },
};
