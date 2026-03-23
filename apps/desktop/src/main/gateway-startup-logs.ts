const STARTUP_FAILURE_PATTERNS = [
  /EADDRINUSE/i,
  /address already in use/i,
  /EACCES/i,
  /permission denied/i,
  /Cannot find package/i,
  /Cannot find module/i,
  /ERR_MODULE_NOT_FOUND/i,
];

const GENERIC_ERROR_PATTERNS = [/ERR_[A-Z0-9_]+/i, /\bError\b/i];

const STARTUP_NOISE_PATTERNS = [
  /^Node\.js v\d+/i,
  /^\^$/,
  /^at\s+/,
  /^node:internal\//,
  /^file:\/\/.+:\d+:\d+$/,
];

const STARTUP_LOG_BUFFER_LIMIT = 80;

const BOOTSTRAP_TOKEN_LINE_PATTERN =
  /^(?<prefix>.*?)(?<label>system|default-tenant-admin):\s*(?<token>tyrum-token\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?<suffix>\s*)$/;

type BootstrapTokenChunkProcessor = {
  processChunk(chunk: string): string;
  flushRemainder(): string;
};

function isStartupNoiseLine(line: string): boolean {
  return STARTUP_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

export function summarizeGatewayStartupFailure(startupLogLines: string[]): string | undefined {
  const normalizedLines = startupLogLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (normalizedLines.length === 0) {
    return undefined;
  }

  for (const pattern of STARTUP_FAILURE_PATTERNS) {
    const matched = normalizedLines.find((line) => pattern.test(line));
    if (matched) {
      return matched;
    }
  }

  for (const pattern of GENERIC_ERROR_PATTERNS) {
    const matched = normalizedLines.find((line) => pattern.test(line) && !isStartupNoiseLine(line));
    if (matched) {
      return matched;
    }
  }

  const meaningfulLines = normalizedLines.filter((line) => !isStartupNoiseLine(line));
  return meaningfulLines.at(-1);
}

export function appendGatewayStartupLogLines(buffer: string[], rawOutput: string): void {
  const lines = rawOutput
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return;

  buffer.push(...lines);
  if (buffer.length > STARTUP_LOG_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - STARTUP_LOG_BUFFER_LIMIT);
  }
}

export function createGatewayBootstrapTokenChunkProcessor(
  tokens: Map<string, string>,
): BootstrapTokenChunkProcessor {
  let remainder = "";

  const processLine = (rawLine: string): string => {
    const match = BOOTSTRAP_TOKEN_LINE_PATTERN.exec(rawLine);
    const prefix = match?.groups?.["prefix"] ?? "";
    const label = match?.groups?.["label"];
    const token = match?.groups?.["token"];
    const suffix = match?.groups?.["suffix"] ?? "";
    if (label && token) {
      tokens.set(label, token);
      return `${prefix}${label}: [REDACTED]${suffix}`;
    }
    return rawLine;
  };

  const processText = (text: string): { output: string; nextRemainder: string } => {
    const parts = text.split(/(\r?\n)/g);
    let output = "";
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const rawLine = parts[i] ?? "";
      const newline = parts[i + 1] ?? "";
      output += processLine(rawLine) + newline;
    }
    return { output, nextRemainder: parts.at(-1) ?? "" };
  };

  return {
    processChunk(chunk: string): string {
      const combined = remainder + chunk;
      const processed = processText(combined);
      remainder = processed.nextRemainder;
      return processed.output;
    },
    flushRemainder(): string {
      const pending = remainder;
      remainder = "";
      if (!pending) return "";
      return processLine(pending);
    },
  };
}
