export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLogLevel(raw: string | undefined): LogLevel {
  const v = raw?.trim().toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error" || v === "silent") {
    return v;
  }
  return "info";
}

function shouldEmit(configured: LogLevel, level: Exclude<LogLevel, "silent">): boolean {
  if (configured === "silent") return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

export interface LogFields {
  [key: string]: unknown;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly base: LogFields;

  constructor(opts?: { level?: LogLevel; base?: LogFields }) {
    this.level =
      opts?.level ??
      parseLogLevel(process.env["TYRUM_LOG_LEVEL"] ?? process.env["LOG_LEVEL"]);
    this.base = opts?.base ?? {};
  }

  child(fields: LogFields): Logger {
    return new Logger({ level: this.level, base: { ...this.base, ...fields } });
  }

  debug(msg: string, fields?: LogFields): void {
    this.emit("debug", msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.emit("info", msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.emit("warn", msg, fields);
  }

  error(msg: string, fields?: LogFields): void {
    this.emit("error", msg, fields);
  }

  private emit(level: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields): void {
    if (!shouldEmit(this.level, level)) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...(fields ?? {}),
    };
    // Structured logs by default (JSON lines).
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
  }
}

