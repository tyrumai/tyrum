import { Writable } from "node:stream";
import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogFields {
  [key: string]: unknown;
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

export class Logger {
  private readonly level: LogLevel;
  private readonly base: LogFields;
  private readonly inner: PinoLogger;

  constructor(
    opts?: { level?: LogLevel; base?: LogFields },
    inner: PinoLogger = createPinoLogger(opts?.level ?? "info", opts?.base ?? {}),
  ) {
    this.level = opts?.level ?? "info";
    this.base = opts?.base ?? {};
    this.inner = inner;
  }

  child(fields: LogFields): Logger {
    return new Logger(
      { level: this.level, base: { ...this.base, ...fields } },
      this.inner.child(fields),
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
    this.inner[level](fields, msg);
  }
}
