import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
const scenario = process.argv[2];
if (!scenario) {
  for (const name of [
    "normal",
    "native-stream",
    "deferred",
    "offline",
    "bad-settings",
    "oversized",
  ])
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], {
      stdio: "inherit",
      timeout: 10000,
    });
  process.exit(0);
}
if (scenario === "native-stream") {
  const RequestNative = globalThis.Request;
  globalThis.Request = class extends RequestNative {
    constructor(input, init) {
      if (
        init &&
        Object.prototype.hasOwnProperty.call(init, "headers") &&
        init.headers === undefined
      )
        throw new TypeError("Native Request does not accept undefined headers");
      super(input, init);
    }
  };
}
const json = (path) =>
  JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));
const manifest = json("src/appmeta/manifest.json"),
  schema = json("src/appmeta/settings.json"),
  pkg = json("package.json");
const defaults = (fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, f]) => [
      key,
      f.type === "group" ? defaults(f.fields) : f.default,
    ]),
  );
const values = defaults(schema.fields);
if ("source_url" in values) values.source_url = "https://feed.example/data";
if ("services" in values)
  values.services = "Service=https://feed.example/health";
const example = existsSync(
  new URL("../examples/response.json", import.meta.url),
)
  ? json("examples/response.json")
  : {};
const state = new Map();
const writes = [];
globalThis.localStorage = {
  getItem: (key) => state.get(key) ?? null,
  setItem: (key, value) => {
    state.set(key, String(value));
    writes.push(key);
  },
};
let handler,
  unbound = false,
  releaseSettings;
const calls = [];
const activeIntervals = new Set();
const setIntervalNative = globalThis.setInterval;
const clearIntervalNative = globalThis.clearInterval;
globalThis.setInterval = (...args) => {
  const handle = setIntervalNative(...args);
  activeIntervals.add(handle);
  return handle;
};
globalThis.clearInterval = (handle) => {
  activeIntervals.delete(handle);
  return clearIntervalNative(handle);
};
const diagnostics = [];
console.error = (...args) => diagnostics.push(args.join(" "));
globalThis.listen = (name, fn) => {
  assert.equal(name, "input");
  handler = fn;
  return () => {
    unbound = true;
  };
};
const response = (value, status = 200) => {
  if (
    scenario === "native-stream" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    value = { ...value, padding: "x".repeat(20000) };
  const res = new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (scenario === "native-stream") {
    const body = res.body;
    Object.defineProperty(res, "body", {
      value: {
        cancel: () => body.cancel(),
        getReader: () => {
          const reader = body.getReader();
          return {
            read: () => reader.read(),
            cancel: () => reader.cancel(),
            closed: reader.closed,
          };
        },
      },
    });
  }
  return res;
};
globalThis.fetch = async (input) => {
  const req = input instanceof Request ? input : new Request(input);
  const body = req.body ? await req.text() : "";
  calls.push({ method: req.method, url: req.url, body });
  const u = new URL(req.url);
  if (u.hostname === "localhost") {
    const allowed = [
      "apps/settings",
      "display/draw",
      "audio/play",
      "status",
      "wifi/status",
    ];
    assert.ok(
      allowed.includes(u.pathname.slice(5)),
      "Unexpected local API: " + u.pathname,
    );
    if (u.pathname === "/api/apps/settings") {
      assert.equal(req.method, "GET");
      assert.equal(u.searchParams.get("app_id"), manifest.id);
      if (scenario === "deferred")
        return new Promise((resolve) => {
          releaseSettings = () => resolve(response({ version: 1, values }));
        });
      return response({
        version: scenario === "bad-settings" ? 999 : 1,
        values,
      });
    }
    if (u.pathname === "/api/status")
      return response({
        power: { battery_charge: 81, state: "charging", battery_voltage: 4100 },
        firmware: { version: "1.0.0" },
        system: { api_semver: manifest.api_version, uptime: "1h" },
        device: {},
      });
    if (u.pathname === "/api/wifi/status")
      return response({ state: "connected", ssid: "Home", ip: "192.0.2.10" });
    if (
      u.pathname === "/api/display/draw" &&
      req.method === "DELETE" &&
      !JSON.parse(body).element_ids
    ) {
      assert.ok(
        activeIntervals.size > 0,
        "Native runner must stay alive until cleanup finishes",
      );
    }
    return response({ result: "ok" });
  }
  if (scenario === "offline") return response({ error: "Unavailable" }, 503);
  if (scenario === "oversized")
    return new Response("x".repeat(25000), {
      headers: { "Content-Length": "25000" },
    });
  if (req.method === "POST") return response({ result: "ok" });
  return response(example);
};
const archive = new URL("../dist/" + manifest.id + ".tgz", import.meta.url);
const list = execFileSync("tar", ["-tzf", fileURLToPath(archive)], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
assert.ok(
  list.every(
    (name) => name.startsWith(manifest.id + "/") && !name.includes(".."),
  ),
);
for (const name of [
  "appmeta/manifest.json",
  "appmeta/settings.json",
  "appmeta/icon_front_8x8.png",
  "appmeta/icon_back_11x11.png",
  "scripts/main.js",
  "resources/LICENSE",
])
  assert.ok(list.includes(manifest.id + "/" + name), "Missing " + name);
assert.equal(manifest.version, pkg.version);
const bundled = readFileSync(
  new URL("../dist/" + manifest.id + "/scripts/main.js", import.meta.url),
  "utf8",
);
new Script(bundled);
await import(
  new URL("../dist/" + manifest.id + "/scripts/main.js", import.meta.url).href
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (scenario === "deferred") {
  await wait(30);
  assert.equal(handler, undefined);
  assert.equal(
    calls.some((c) => c.url.endsWith("/display/draw")),
    false,
  );
  releaseSettings();
}
await wait(250);
assert.equal(typeof handler, "function");
const draws = calls.filter(
  (c) => c.method === "POST" && c.url.endsWith("/display/draw"),
);
assert.ok(draws.length > 0, "No display output");
const elements = draws.flatMap((c) => JSON.parse(c.body).elements);
for (const side of ["front", "back"])
  assert.ok(elements.some((e) => e.display === side));
for (const e of elements) {
  assert.ok(e.x >= 0 && e.y >= 0);
  assert.ok(
    e.x < (e.display === "front" ? 72 : 160) &&
      e.y < (e.display === "front" ? 16 : 80),
  );
  if (e.type === "text") assert.ok(e.text.length > 0);
}
if (["normal", "native-stream", "deferred"].includes(scenario)) {
  assert.equal(diagnostics.length, 0, diagnostics.join("\n"));
  const visible = new Map(elements.map((e) => [e.id, e]));
  if ("services" in values)
    assert.equal(
      visible.get("back-value")?.text,
      "HTTP 200",
      "Health response was not applied",
    );
  if (manifest.id.endsWith(".device_dashboard"))
    assert.equal(
      visible.get("back-value")?.text,
      "81%",
      "Local device response was not applied",
    );
  if ("source_url" in values && Object.keys(example).length) {
    assert.notEqual(
      visible.get("back-value")?.text,
      "SET SOURCE",
      "Configured source was not applied",
    );
    assert.notEqual(
      visible.get("back-value")?.text,
      "NO DATA",
      "Valid feed was not displayed",
    );
  }
}
handler({ key: "encoder", action: "clockwise", delta: 1 });
handler({ key: "ok", action: "press" });
handler({ key: "ok", action: "release" });
handler({ key: "ok", action: "short" });
await wait(150);
for (let i = 0; i < 4 && !unbound; i++) {
  handler({ key: "back", action: "short" });
  await wait(50);
}
assert.ok(unbound, "Back did not release input listener");
await wait(100);
assert.ok(
  calls.some(
    (c) =>
      c.method === "DELETE" &&
      c.url.endsWith("/display/draw") &&
      !JSON.parse(c.body).element_ids,
  ),
  "Display not cleared at exit",
);
const count = calls.length;
await wait(150);
assert.equal(calls.length, count, "Requests continued after exit");
assert.equal(activeIntervals.size, 0, "Timers survived app exit");
assert.ok(writes.includes("state-v1"));
if (scenario === "bad-settings")
  assert.ok(diagnostics.some((v) => v.includes("default settings")));
console.log("Smoke passed: " + scenario);
