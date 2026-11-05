import manifest from "./appmeta/manifest.json";
import schema from "./appmeta/settings.json";
import { AppModel } from "./model.ts";
import {
  App,
  clamp,
  num,
  parseSettings,
  record,
  schemaDefaults,
  type HttpSpec,
  type View,
} from "./lib.ts";

const APP = manifest.id;
const API = "http://" + __BUSY_ADDR__ + "/api/";
const STATE_KEY = "state-v1";
const MAX_BODY_BYTES = 24576;
const POLL_TIMEOUT_MS = 10000;
type Element = Record<string, unknown> & { id: string };
let model: App;
let stopped = false;
let unbind: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let pending = false;
let pendingSince = 0;
let nextPoll = 0;
let nextPaint = 0;
let paintBusy = false;
let desiredView: View | undefined;
let painted = new Map<string, string>();
let saved = "";
let nextSave = 0;
let audioBusy = false;
let ownsAudio = false;
let audioUntil = 0;
let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

function report(message: string): void {
  console.error(APP + ": " + message);
}
async function local(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const response = await fetch(
    new Request(API + path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw new Error("HTTP " + response.status + " at " + path.split("?")[0]);
  }
  if (!path.startsWith("apps/settings")) await response.text();
  return response;
}
function decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i++];
    if (first < 128) {
      out += String.fromCharCode(first);
      continue;
    }
    const count = first >= 240 ? 3 : first >= 224 ? 2 : first >= 194 ? 1 : -1;
    if (count < 0 || i + count > bytes.length) throw new Error("Invalid UTF-8");
    let code = first & (127 >> count);
    for (let j = 0; j < count; j++) {
      const byte = bytes[i++];
      if ((byte & 192) !== 128) throw new Error("Invalid UTF-8");
      code = (code << 6) | (byte & 63);
    }
    if (
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff) ||
      (count === 1 && code < 128) ||
      (count === 2 && code < 2048) ||
      (count === 3 && code < 65536)
    )
      throw new Error("Invalid UTF-8");
    out += String.fromCodePoint(code);
  }
  return out;
}
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw new Error("Response too large");
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  activeReader = reader;
  void reader.closed.catch(() => {});
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (stopped || size + chunk.value.length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(stopped ? "Stopped" : "Response too large");
      }
      bytes.set(chunk.value, size);
      size += chunk.value.length;
    }
    const value = decode(bytes.subarray(0, size));
    return value.trim() ? JSON.parse(value) : {};
  } finally {
    activeReader = undefined;
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }
}
function label(
  id: string,
  display: string,
  x: number,
  y: number,
  value: string,
  font: string,
  width: number,
  color: string,
): Element {
  return {
    id,
    type: "text",
    display,
    x,
    y,
    align: "top_left",
    text: value || " ",
    font: /[^\x20-\x7e]/.test(value) ? "global" : font,
    width,
    color,
    z_index: 2,
    scroll_rate: 1200,
    scroll_start_delay: 1200,
    scroll_repeat_delay: 1800,
  };
}
function elements(view: View): Element[] {
  const color = /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(view.color || "")
    ? view.color!
    : "#56D4FFFF";
  const opaque = color.length === 7 ? color + "FF" : color;
  const items: Element[] = ["front", "back"].map((display) => ({
    id: "bg-" + display,
    type: "rectangle",
    display,
    x: 0,
    y: 0,
    width: display === "front" ? 72 : 160,
    height: display === "front" ? 16 : 80,
    fill: "solid",
    fill_colors: ["#000000FF"],
    border_width: 0,
    z_index: 0,
  }));
  const art = view.image || view.shapes;
  if (!art) {
    const unicode = /[^\x20-\x7e]/.test(view.value + view.title);
    items.push(
      label(
        "front-title",
        "front",
        1,
        0,
        unicode ? "" : view.title.toUpperCase(),
        "tiny",
        70,
        opaque,
      ),
    );
    items.push(
      label(
        "front-value",
        "front",
        1,
        unicode ? 2 : 7,
        view.value,
        view.compact ? "small" : "normal",
        70,
        "#FFFFFFFF",
      ),
    );
  }
  if (view.image)
    items.push({
      id: "scene",
      type: "image",
      display: "front",
      path: view.image,
      x: 0,
      y: 0,
      z_index: 1,
    });
  if (view.shapes)
    for (let index = 0; index < view.shapes.length; index++) {
      const shape = view.shapes[index];
      items.push({
        id: "shape-" + index,
        type: "rectangle",
        display: "front",
        x: Math.floor(clamp(shape.x, 0, 71)),
        y: Math.floor(clamp(shape.y, 0, 15)),
        width: Math.ceil(clamp(shape.width, 1, 72 - shape.x)),
        height: Math.ceil(clamp(shape.height, 1, 16 - shape.y)),
        border_width: 0,
        fill: "solid",
        fill_colors: [
          shape.color.length === 7 ? shape.color + "FF" : shape.color,
        ],
        z_index: 1,
      });
    }
  items.push(
    label("back-title", "back", 3, 2, view.title, "normal", 126, "#FFFFFFFF"),
  );
  items.push({
    id: "back-icon",
    type: "image",
    display: "back",
    path: "appmeta/icon_back_11x11.png",
    x: 133,
    y: 2,
    z_index: 2,
  });
  items.push(
    label(
      "back-value",
      "back",
      3,
      17,
      view.value,
      view.value.length <= 10 && !view.compact ? "extra_large" : "normal",
      140,
      "#FFFFFFFF",
    ),
  );
  for (let index = 0; index < 3; index++)
    items.push(
      label(
        "back-row-" + index,
        "back",
        3,
        34 + index * 11,
        (view.rows || [])[index] || "",
        "normal",
        140,
        "#FFFFFFFF",
      ),
    );
  items.push(
    label(
      "back-hint",
      "back",
      3,
      70,
      view.hint || "OK select / Back exit",
      "tiny",
      140,
      "#AAAAAAFF",
    ),
  );
  if (view.progress !== undefined) {
    items.push({
      id: "progress-bg",
      type: "rectangle",
      display: "back",
      x: 3,
      y: 77,
      width: 140,
      height: 2,
      border_width: 0,
      fill: "solid",
      fill_colors: ["#333333FF"],
      z_index: 1,
    });
    items.push({
      id: "progress-value",
      type: "rectangle",
      display: "back",
      x: 3,
      y: 77,
      width: Math.max(1, Math.round(clamp(view.progress, 0, 1) * 140)),
      height: 2,
      border_width: 0,
      fill: "solid",
      fill_colors: ["#FFFFFFFF"],
      z_index: 2,
    });
  }
  return items;
}
async function drainPaint(): Promise<void> {
  if (paintBusy) return;
  paintBusy = true;
  try {
    while (desiredView && !stopped) {
      const view = desiredView;
      desiredView = undefined;
      const all = elements(view);
      const next = new Map(all.map((item) => [item.id, JSON.stringify(item)]));
      const changed = all.filter(
        (item) => painted.get(item.id) !== next.get(item.id),
      );
      const removed = [...painted.keys()].filter((id) => !next.has(id));
      if (removed.length)
        await local("display/draw", "DELETE", {
          application_name: APP,
          element_ids: removed,
        });
      for (let offset = 0; offset < changed.length && !stopped; offset += 8) {
        await local("display/draw", "POST", {
          application_name: APP,
          priority: 50,
          elements: changed.slice(offset, offset + 8),
        });
      }
      painted = next;
    }
  } catch (error) {
    painted.clear();
    report(error instanceof Error ? error.message : "Display unavailable");
  } finally {
    paintBusy = false;
  }
}
function persist(force = false): void {
  const now = Date.now();
  if (!force && now < nextSave) return;
  const serialized = JSON.stringify(model.save());
  if (serialized !== saved && serialized.length <= 8192) {
    try {
      localStorage.setItem(STATE_KEY, serialized);
      saved = serialized;
    } catch {
      report("Cannot save app state");
    }
  }
  nextSave = now + 1000;
}
async function drainAudio(): Promise<void> {
  if (audioBusy || stopped) return;
  audioBusy = true;
  try {
    const effect = model.effects.shift();
    if (!effect) return;
    if (
      (effect.stopAudio || effect.sound) &&
      ownsAudio &&
      Date.now() < audioUntil
    )
      await local("audio/play", "DELETE").catch(() => {});
    if (effect.sound && !stopped) {
      const allowed = ["notify", "tick", "accent", "chime", "pop", "bell"];
      if (!allowed.includes(effect.sound)) return;
      await local("audio/play", "POST", {
        application_name: APP,
        path: "sounds/" + effect.sound + ".snd",
      });
      ownsAudio = true;
      audioUntil =
        Date.now() +
        ({ notify: 230, tick: 85, accent: 95, chime: 290, pop: 110, bell: 300 }[
          effect.sound
        ] || 300);
    } else ownsAudio = false;
  } catch {
    model.fail("Audio unavailable");
  } finally {
    audioBusy = false;
  }
}
async function poll(now: number): Promise<void> {
  if (pending || stopped) return;
  let spec: HttpSpec | undefined;
  const command = model.pendingCommand;
  if (!command && now < nextPoll) return;
  try {
    spec = command || model.request(now);
  } catch (error) {
    model.fail(error instanceof Error ? error.message : "Set source in Setup");
    nextPoll = now + 10000;
    return;
  }
  if (!spec) return;
  model.pendingCommand = undefined;
  pending = true;
  pendingSince = now;
  nextPoll = now + num(model.settings, "refresh_s", 30) * 1000;
  const current = spec;
  try {
    const response = await fetch(
      new Request(current.url, {
        method: current.method || "GET",
        ...(current.headers === undefined ? {} : { headers: current.headers }),
        ...(current.body === undefined ? {} : { body: current.body }),
      }),
    );
    if (!response.ok && current.response !== "status") {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error("HTTP " + response.status);
    }
    let payload: unknown;
    if (current.response === "status") {
      payload = {
        status: response.status,
        elapsed_ms: Date.now() - pendingSince,
      };
      if (response.body) await response.body.cancel().catch(() => {});
    } else payload = await readJson(response);
    if (!stopped && Date.now() - pendingSince <= POLL_TIMEOUT_MS)
      model.receive(payload, Date.now(), current.kind);
  } catch (error) {
    if (!stopped)
      model.fail(
        error instanceof Error ? error.message : "Connection unavailable",
      );
  } finally {
    pending = false;
    model.commandBusy = false;
  }
}
async function shutdown(): Promise<void> {
  if (stopped) return;
  stopped = true;
  unbind?.();
  model.effects.length = 0;
  model.pendingCommand = undefined;
  persist(true);
  if (activeReader) await activeReader.cancel().catch(() => {});
  while (paintBusy || audioBusy)
    await new Promise((resolve) => setTimeout(resolve, 20));
  if (ownsAudio && Date.now() < audioUntil)
    await local("audio/play", "DELETE").catch(() => {});
  await local("display/draw", "DELETE", { application_name: APP }).catch(
    () => {},
  );
  console.info(APP + ": stopped");
  if (timer !== undefined) clearInterval(timer);
}
function tick(): void {
  if (stopped) return;
  const now = Date.now();
  try {
    model.tick(now);
    if (pending && now - pendingSince > POLL_TIMEOUT_MS)
      model.fail("Connection timed out");
    if (now >= nextPaint) {
      desiredView = model.view(now);
      nextPaint = now + 150;
      void drainPaint();
    }
    if (model.effects.length > 4)
      model.effects.splice(0, model.effects.length - 4);
    void drainAudio();
    void poll(now);
    persist();
  } catch (error) {
    report(error instanceof Error ? error.message : "App update failed");
  }
}
async function run(): Promise<void> {
  let settings = schemaDefaults(schema.fields);
  try {
    settings = parseSettings(
      schema.fields,
      await readJson(
        await local("apps/settings?app_id=" + encodeURIComponent(APP)),
      ),
    );
  } catch (error) {
    report(
      "Using default settings: " +
        (error instanceof Error ? error.message : "settings unavailable"),
    );
  }
  let stored = {};
  try {
    stored = record(JSON.parse(localStorage.getItem(STATE_KEY) || "{}"));
  } catch {
    report("Ignoring unreadable app state");
  }
  model = new AppModel(settings, stored, Date.now());
  unbind = listen("input", (event) => {
    try {
      if (stopped) return;
      const isWheel =
        event.key === "encoder" &&
        (event.action === "clockwise" || event.action === "counterclockwise");
      if (!isWheel && event.action !== "short") return;
      const key = isWheel ? "wheel" : event.key;
      const delta = isWheel
        ? clamp(event.delta || (event.action === "clockwise" ? 1 : -1), -32, 32)
        : 0;
      if (key === "start") return;
      if (key === "back" && !model.key(key, delta, Date.now())) {
        void shutdown();
        return;
      }
      if (key !== "back") model.key(key, delta, Date.now());
      if (key === "ok") nextPoll = 0;
      nextPaint = 0;
      tick();
    } catch (error) {
      model.fail(error instanceof Error ? error.message : "Action unavailable");
      nextPaint = 0;
      tick();
    }
  });
  timer = setInterval(tick, 50);
  tick();
  console.info(APP + ": started");
}
void run().catch((error) =>
  report(error instanceof Error ? error.message : "Startup failed"),
);
