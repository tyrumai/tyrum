import { Writable } from "node:stream";
import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogFields {
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  base?: LogFields;
  logStackTraces?: boolean;
}

const consoleDestination = new Writable({
  write(chunk, _encoding, callback) {
    const line = chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk);
    // Structured logs by default (JSON lines).
    // eslint-disable-next-line no-console
    console.log(line.trimEnd());
    callback();
  },
});

function createPinoLogger(level: LogLevel, base: LogFields): PinoLogger {
  return pino(
    {
      level,
      base,
      messageKey: "msg",
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    consoleDestination,
  );
}

function serializeError(error: Error, logStackTraces: boolean): LogFields {
  return {
    type: error.name,
    message: error.message,
    ...(logStackTraces && error.stack ? { stack: error.stack } : {}),
  };
}

function normalizeLogFields(fields: LogFields, logStackTraces: boolean): LogFields {
  let normalized: LogFields | undefined;

  for (const [key, value] of Object.entries(fields)) {
    if (!(value instanceof Error)) {
      if (normalized) {
        normalized[key] = value;
      }
      continue;
    }

    normalized ??= { ...fields };
    normalized[key] = serializeError(value, logStackTraces);
  }

  return normalized ?? fields;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly base: LogFields;
  private readonly logStackTraces: boolean;
  private readonly inner: PinoLogger;

  constructor(
    opts?: LoggerOptions,
    inner: PinoLogger = createPinoLogger(
      opts?.level ?? "info",
      normalizeLogFields(opts?.base ?? {}, Boolean(opts?.logStackTraces)),
    ),
  ) {
    this.level = opts?.level ?? "info";
    this.base = normalizeLogFields(opts?.base ?? {}, Boolean(opts?.logStackTraces));
    this.logStackTraces = Boolean(opts?.logStackTraces);
    this.inner = inner;
  }

  child(fields: LogFields): Logger {
    const normalizedFields = normalizeLogFields(fields, this.logStackTraces);
    return new Logger(
      {
        level: this.level,
        base: { ...this.base, ...normalizedFields },
        logStackTraces: this.logStackTraces,
      },
      this.inner.child(normalizedFields),
    );
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

  private emit(level: Exclude<LogLevel, "silent">, msg: string, fields: LogFields = {}): void {
    this.inner[level](normalizeLogFields(fields, this.logStackTraces), msg);
  }
}
