export type Settings = Record<string, unknown>;
export type Shape = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};
export type View = {
  title: string;
  value: string;
  rows?: string[];
  hint?: string;
  color?: string;
  progress?: number;
  shapes?: Shape[];
  image?: string;
  compact?: boolean;
};
export type HttpSpec = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  kind?: string;
  response?: "json" | "status";
};
export type Effect = { sound?: string; stopAudio?: boolean };
export const MINUTE = 60_000;
export const DAY = 86_400_000;

export function record(value: unknown): Settings {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Settings)
    : {};
}
export function str(obj: Settings, key: string, fallback = ""): string {
  return typeof obj[key] === "string" ? (obj[key] as string) : fallback;
}
export function num(obj: Settings, key: string, fallback = 0): number {
  return typeof obj[key] === "number" && Number.isFinite(obj[key])
    ? (obj[key] as number)
    : fallback;
}
export function flag(obj: Settings, key: string, fallback = false): boolean {
  return typeof obj[key] === "boolean" ? (obj[key] as boolean) : fallback;
}
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
export function cycle(value: number, delta: number, count: number): number {
  return count ? (((value + delta) % count) + count) % count : 0;
}
export function bounded(
  value: unknown,
  min: number,
  max: number,
  fallback = min,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}
export function text(value: unknown, max = 160): string {
  return typeof value === "string"
    ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max)
    : "";
}
export function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected a finite number");
  return value;
}
export function requiredText(value: unknown, max = 160): string {
  const result = text(value, max);
  if (!result.trim()) throw new Error("Expected nonempty text");
  return result;
}
export function entries(value: unknown, limit = 32): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error("Invalid item list");
  return value;
}
export function pad(value: number): string {
  return String(Math.floor(value)).padStart(2, "0");
}
export function duration(ms: number, tenths = false): string {
  const seconds = Math.max(0, ms) / 1000;
  if (tenths && seconds < 60) return seconds.toFixed(1);
  return Math.floor(seconds / 60) + ":" + pad(seconds % 60);
}
export function compact(value: number, digits = 1): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(digits) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(digits) + "M";
  if (abs >= 1e3) return (value / 1e3).toFixed(digits) + "K";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}
export function localDay(now: number, offsetMinutes = 0): string {
  const d = new Date(now + offsetMinutes * MINUTE);
  return (
    d.getUTCFullYear() +
    "-" +
    pad(d.getUTCMonth() + 1) +
    "-" +
    pad(d.getUTCDate())
  );
}
export function splitList(value: string, limit = 12): string[] {
  return value
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}
export function url(value: string): string {
  if (
    !/^https?:\/\/[^\s/@]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(value) ||
    value.length > 255
  )
    throw new Error("Set a valid HTTP(S) URL in Setup");
  return value;
}
export function bearer(settings: Settings): Record<string, string> {
  const token = str(settings, "token");
  return token ? { Authorization: "Bearer " + token } : {};
}
export function source(settings: Settings, path = ""): HttpSpec {
  return {
    url: url(str(settings, "source_url")).replace(/\/$/, "") + path,
    headers: bearer(settings),
  };
}
export function timestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return value;
  if (typeof value === "string") {
    const n = Date.parse(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error("Invalid timestamp");
}

export class App {
  settings: Settings;
  stored: Settings;
  now: number;
  effects: Effect[] = [];
  error = "";
  lastReceived = 0;
  pendingCommand: HttpSpec | undefined;
  commandBusy = false;
  constructor(settings: Settings, stored: Settings, now: number) {
    this.settings = settings;
    this.stored = stored;
    this.now = now;
  }
  tick(now: number): void {
    this.now = now;
  }
  key(_key: string, _delta: number, _now: number): boolean {
    return false;
  }
  view(_now: number): View {
    return { title: "Ready", value: "READY" };
  }
  save(): Settings {
    return this.stored;
  }
  request(_now: number): HttpSpec | undefined {
    return undefined;
  }
  receive(_value: unknown, now: number, _kind?: string): void {
    this.lastReceived = now;
    this.error = "";
  }
  fail(message: string): void {
    this.error = message.slice(0, 96);
  }
  notify(sound = "notify"): void {
    if (flag(this.settings, "sound", true)) this.effects.push({ sound });
  }
  stopSound(): void {
    this.effects.push({ stopAudio: true });
  }
  send(spec: HttpSpec): void {
    if (this.commandBusy || this.pendingCommand) return;
    this.pendingCommand = spec;
    this.commandBusy = true;
  }
  feedView(
    title: string,
    value: string,
    rows: string[],
    now: number,
    color = "#56D4FFFF",
  ): View {
    const stale =
      this.lastReceived > 0 &&
      now - this.lastReceived > num(this.settings, "refresh_s", 30) * 3000;
    return {
      title,
      value,
      rows,
      color: this.error || stale ? "#FFB347FF" : color,
      hint: this.commandBusy
        ? "SENDING..."
        : this.error
          ? this.error
          : stale
            ? "STALE DATA"
            : "OK refresh / wheel browse",
    };
  }
}

export class Feed extends App {
  items: Settings[] = [];
  selected = 0;
  updated = 0;
  request(_now: number): HttpSpec {
    return source(this.settings);
  }
  key(key: string, delta: number, _now: number): boolean {
    if (key === "wheel")
      this.selected = cycle(this.selected, delta, this.items.length);
    return false;
  }
  commit(items: Settings[], now: number, updated: unknown = now): void {
    const stamp = timestamp(updated);
    if (stamp < this.updated) return;
    this.items = items;
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
    this.updated = stamp;
    this.lastReceived = Math.min(now, stamp);
    this.error = "";
  }
  empty(title: string, now: number): View {
    return this.feedView(
      title,
      str(this.settings, "source_url") ? "NO DATA" : "SET SOURCE",
      ["Open Setup to configure source"],
      now,
    );
  }
}

export function schemaDefaults(fields: Settings): Settings {
  const values: Settings = {};
  for (const key of Object.keys(fields)) {
    const field = record(fields[key]);
    values[key] =
      field.type === "group"
        ? schemaDefaults(record(field.fields))
        : field.default;
  }
  return values;
}
function validField(field: Settings, value: unknown): boolean {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "integer")
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= num(field, "min", -2147483648) &&
      value <= num(field, "max", 2147483647)
    );
  if (field.type === "string")
    return (
      typeof value === "string" &&
      value.length >= num(field, "min_length") &&
      value.length <= num(field, "max_length", 64)
    );
  if (field.type === "enum")
    return (
      Array.isArray(field.options) &&
      field.options.some((option) => record(option).value === value)
    );
  if (field.type === "color")
    return (
      typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
    );
  if (field.type === "time")
    return (
      typeof value === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)
    );
  if (field.type === "geolocation") {
    const geo = record(value);
    return (
      typeof geo.name === "string" &&
      (geo.mode === "auto" ||
        (geo.mode === "fixed" &&
          num(geo, "lat", 999) >= -90 &&
          num(geo, "lat", 999) <= 90 &&
          num(geo, "lon", 999) >= -180 &&
          num(geo, "lon", 999) <= 180))
    );
  }
  return false;
}
export function parseSettings(fields: Settings, document: unknown): Settings {
  const doc = record(document);
  if (
    doc.version !== 1 ||
    !doc.values ||
    Array.isArray(doc.values) ||
    typeof doc.values !== "object"
  )
    throw new Error("Invalid settings document");
  const read = (nodes: Settings, input: Settings): Settings => {
    const out = schemaDefaults(nodes);
    for (const key of Object.keys(nodes)) {
      const field = record(nodes[key]);
      if (field.type === "group")
        out[key] = read(record(field.fields), record(input[key]));
      else if (validField(field, input[key])) out[key] = input[key];
    }
    return out;
  };
  return read(fields, record(doc.values));
}
