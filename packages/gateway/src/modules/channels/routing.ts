import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";

export type TelegramRoutingConfig = {
  default_agent_key?: string;
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
              default_agent_key:
                typeof telegram["default_agent_key"] === "string"
                  ? String(telegram["default_agent_key"]).trim()
                  : undefined,
              threads: Object.keys(threadMap).length > 0 ? threadMap : undefined,
            }
          : undefined,
      };
    } catch (err) {
      // Intentional: routing config is optional; ignore missing/invalid config files.
      void err;
    }
  }

  return { v: 1 };
}

export function resolveTelegramAgentId(config: RoutingConfig, threadId: string): string {
  const t = threadId.trim();
  const telegram = config.telegram;
  if (telegram?.threads && t && telegram.threads[t]) {
    return String(telegram.threads[t]).trim() || telegram.default_agent_key?.trim() || "default";
  }
  return telegram?.default_agent_key?.trim() || "default";
}
