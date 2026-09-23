/**
 * Structured logging, with no dependency.
 *
 * Every line is one event: a dotted name saying what happened (`job.failed`,
 * `share.unlock_locked`) plus flat fields. That is what a log aggregator can
 * filter on, and what `console.warn("could not do X:", error)` never was.
 *
 * Two output formats, chosen by `LOG_FORMAT`:
 *
 *   text (default)  2026-09-22T20:14:03.117Z WARN  job.failed type=CHECKSUM …
 *   json            {"time":"…","level":"warn","event":"job.failed",…}
 *
 * Text stays the default because the operator this product is built for reads
 * `docker logs` by eye, and some messages — the "SMTP is not configured" block
 * that carries a password-reset link — are meant to be read, not parsed. JSON
 * is one environment variable away for anyone shipping logs somewhere.
 *
 * `LOG_LEVEL` filters: debug < info < warn < error. Default info.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function threshold(): number {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return raw && raw in LEVELS ? LEVELS[raw as LogLevel] : LEVELS.info;
}

function jsonFormat(): boolean {
  return process.env.LOG_FORMAT?.toLowerCase() === "json";
}

/** Errors do not survive JSON.stringify; pull out what an operator needs. */
function normalise(value: unknown): unknown {
  if (value instanceof Error) {
    const withCode = value as Error & { code?: unknown; digest?: unknown };

    return {
      name: value.name,
      message: value.message,
      ...(withCode.code !== undefined ? { code: withCode.code } : {}),
      ...(withCode.digest !== undefined ? { digest: withCode.digest } : {}),
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  if (typeof value === "bigint") return value.toString();

  return value;
}

/** `key=value`, quoting anything a shell-eyed reader could misparse. */
function textValue(value: unknown): string {
  const normalised = normalise(value);

  if (normalised === null || normalised === undefined)
    return String(normalised);

  if (typeof normalised === "object") {
    const error = normalised as { message?: unknown };
    // An error reads as its message in text mode; the stack goes on its own
    // lines after the event so it stays copy-pasteable.
    if (value instanceof Error) return JSON.stringify(String(error.message));
    return JSON.stringify(normalised);
  }

  const text = String(normalised);
  return /[\s"=]/.test(text) || text === "" ? JSON.stringify(text) : text;
}

/**
 * Render one event. Split from `emit` so the formatting is testable without
 * capturing the console.
 */
export function formatLine(
  level: LogLevel,
  event: string,
  fields: LogFields,
  {
    json = jsonFormat(),
    now = new Date(),
  }: { json?: boolean; now?: Date } = {},
): string {
  if (json) {
    const body: Record<string, unknown> = {
      time: now.toISOString(),
      level,
      event,
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) body[key] = normalise(value);
    }

    return JSON.stringify(body);
  }

  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${textValue(value)}`);

  const stacks = Object.values(fields)
    .filter((value): value is Error => value instanceof Error && !!value.stack)
    .map((error) => error.stack?.replace(/^/gm, "    "));

  return [
    [now.toISOString(), level.toUpperCase().padEnd(5), event, ...pairs].join(
      " ",
    ),
    ...stacks,
  ].join("\n");
}

function emit(level: LogLevel, event: string, fields: LogFields) {
  if (LEVELS[level] < threshold()) return;

  const line = formatLine(level, event, fields);

  // stderr for the two levels an operator's alerting should look at, stdout
  // for the rest — the split every container runtime already understands.
  if (level === "warn" || level === "error") console.error(line);
  else console.log(line);
}

export type Logger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  /** A logger that adds `fields` to every line — a request id, a job id. */
  child: (fields: LogFields) => Logger;
};

function make(bound: LogFields): Logger {
  return {
    debug: (event, fields = {}) =>
      emit("debug", event, { ...bound, ...fields }),
    info: (event, fields = {}) => emit("info", event, { ...bound, ...fields }),
    warn: (event, fields = {}) => emit("warn", event, { ...bound, ...fields }),
    error: (event, fields = {}) =>
      emit("error", event, { ...bound, ...fields }),
    child: (fields) => make({ ...bound, ...fields }),
  };
}

export const log: Logger = make({});
