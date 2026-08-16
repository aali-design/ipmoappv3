type Level = "info" | "warn" | "error" | "debug";

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(line));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  }
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
};

// Per-request logger that always attaches the X-Request-Id.
export function reqLog(
  requestId: string,
  level: Level,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  emit(level, msg, { requestId, ...fields });
}
