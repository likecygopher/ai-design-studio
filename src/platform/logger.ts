/**
 * Structured JSON logging with sensitive-field redaction.
 *
 * One line per event so container log drivers and log aggregators can parse it.
 * Never log raw credentials: keys matching REDACT_KEY_PATTERN are masked.
 */

const REDACT_KEY_PATTERN =
  /(authorization|cookie|set-cookie|api[-_]?key|apikey|password|passwordhash|token|secret|authsecret|access[-_]?key|private[-_]?key)/i;

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const REDACTED = "[redacted]";

export type LogFields = Record<string, unknown>;
export type LogLevel = "debug" | "info" | "warn" | "error";

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    // Keep strings as-is; key-based redaction is handled by the parent object.
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (depth >= MAX_DEPTH) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACT_KEY_PATTERN.test(key) ? REDACTED : redactValue(nested, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function redactFields(fields: LogFields): LogFields {
  const output: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    output[key] = REDACT_KEY_PATTERN.test(key) ? REDACTED : redactValue(value, 0);
  }
  return output;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redactFields(fields)
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}): Logger {
  return {
    debug(message, fields = {}) {
      if (process.env.NODE_ENV === "test") {
        return;
      }
      write("debug", message, { ...base, ...fields });
    },
    info(message, fields = {}) {
      write("info", message, { ...base, ...fields });
    },
    warn(message, fields = {}) {
      write("warn", message, { ...base, ...fields });
    },
    error(message, error, fields = {}) {
      write("error", message, {
        ...base,
        ...fields,
        ...(error === undefined ? {} : { err: error })
      });
    },
    child(fields) {
      return createLogger({ ...base, ...fields });
    }
  };
}

export const logger: Logger = createLogger();
