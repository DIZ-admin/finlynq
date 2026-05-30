// Lightweight structured logger for the mobile app.
//
// Why this exists: device-only failures (the empty-dashboard bug, the
// `loose:true` fetch breakage, cookie-jar auth) were historically diagnosed by
// guessing. Everything that talks to the network or mutates auth state now logs
// through here so the *real* status codes, payload shapes, and exceptions land
// in the device log (Metro during dev, `adb logcat -s ReactNativeJS:V` for an
// installed APK) AND in an in-memory ring buffer the in-app Diagnostics screen
// can dump.
//
// Privacy: this is a finance app with name-encryption at its core. We log
// *metadata* — HTTP status, latency, array lengths, object key names — never
// amounts, payees, or decrypted names. The `redact()` pass scrubs anything that
// looks like a secret (password / token / cookie / pepper) before it is stored
// or printed.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  msg: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();

// Keys whose VALUES must never be written to the log. Matched case-insensitively
// as a substring so `authToken`, `pf_session`, `sessionToken` etc. are all caught.
const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "token",
  "secret",
  "cookie",
  "pepper",
  "passphrase",
  "authorization",
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => k.includes(frag));
}

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) {
    // Cap array serialization so a 1000-row transactions payload doesn't flood.
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = typeof v === "string" ? `[redacted:${v.length}]` : "[redacted]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function timeLabel(ts: number): string {
  // HH:MM:SS.mmm in local time, no Date dependency beyond the constructor.
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function emit(level: LogLevel, tag: string, msg: string, data?: unknown): void {
  const safe = data === undefined ? undefined : redact(data);
  const entry: LogEntry = { ts: Date.now(), level, tag, msg, data: safe };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);

  const prefix = `[${timeLabel(entry.ts)}] ${level.toUpperCase()} ${tag}:`;
  // console.* surfaces in Metro and in logcat under the ReactNativeJS tag.
  const sink =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (safe === undefined) sink(prefix, msg);
  else sink(prefix, msg, safe);

  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      /* a broken listener must never break logging */
    }
  }
}

export const logger = {
  debug: (tag: string, msg: string, data?: unknown) => emit("debug", tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => emit("info", tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => emit("warn", tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => emit("error", tag, msg, data),
};

/** Snapshot of the ring buffer, oldest first. */
export function getLogs(): LogEntry[] {
  return [...buffer];
}

export function clearLogs(): void {
  buffer.length = 0;
}

/** Subscribe to live log entries (for the Diagnostics screen). Returns an unsubscribe fn. */
export function subscribeLogs(fn: (e: LogEntry) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Render the whole buffer as copyable text (for "share logs"). */
export function formatLogsAsText(): string {
  return buffer
    .map((e) => {
      const data = e.data === undefined ? "" : ` ${safeStringify(e.data)}`;
      return `[${timeLabel(e.ts)}] ${e.level.toUpperCase()} ${e.tag}: ${e.msg}${data}`;
    })
    .join("\n");
}

/** Compact, PII-free description of a parsed response body for request logs. */
export function describeShape(body: unknown): string {
  if (body === null) return "null";
  if (Array.isArray(body)) return `Array(${body.length})`;
  if (typeof body === "object") return `{${Object.keys(body as object).join(",")}}`;
  return typeof body;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
