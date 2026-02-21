import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonOrYaml(contents: string, hintPath?: string): unknown {
  const trimmed = contents.trim();
  if (trimmed.length === 0) return {};
  const isJson = hintPath?.toLowerCase().endsWith(".json") ?? trimmed.startsWith("{");
  if (isJson) return JSON.parse(trimmed) as unknown;
  return parseYaml(trimmed) as unknown;
}

export type TelegramRoutingConfig = {
  default_agent_id?: string;
  threads?: Record<string, string>;
};

export type RoutingConfig = {
  v: number;
  telegram?: TelegramRoutingConfig;
};

export async function loadRoutingConfig(home: string): Promise<RoutingConfig> {
  const candidates = [
    join(home, "routing.yml"),
    join(home, "routing.yaml"),
    join(home, "routing.json"),
  ];

  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = parseJsonOrYaml(raw, path);
      if (!isRecord(parsed)) break;

      const telegram = isRecord(parsed["telegram"]) ? parsed["telegram"] : undefined;
      const threads = telegram && isRecord(telegram["threads"]) ? telegram["threads"] : undefined;
      const threadMap: Record<string, string> = {};
      if (threads) {
        for (const [k, v] of Object.entries(threads)) {
          if (typeof k === "string" && typeof v === "string") {
            threadMap[k] = v;
          }
        }
      }

      return {
        v: typeof parsed["v"] === "number" ? (parsed["v"] as number) : 1,
        telegram: telegram
          ? {
              default_agent_id:
                typeof telegram["default_agent_id"] === "string"
                  ? String(telegram["default_agent_id"]).trim()
                  : undefined,
              threads: Object.keys(threadMap).length > 0 ? threadMap : undefined,
            }
          : undefined,
      };
    } catch {
      // ignore missing/invalid config
    }
  }

  return { v: 1 };
}

export function resolveTelegramAgentId(config: RoutingConfig, threadId: string): string {
  const t = threadId.trim();
  const telegram = config.telegram;
  if (telegram?.threads && t && telegram.threads[t]) {
    return String(telegram.threads[t]).trim() || telegram.default_agent_id?.trim() || "default";
  }
  return telegram?.default_agent_id?.trim() || "default";
}

