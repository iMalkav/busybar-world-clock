import assert from "node:assert/strict";
import test from "node:test";
import schema from "../src/appmeta/settings.json" with { type: "json" };
import {
  parseSettings,
  schemaDefaults,
  record,
  url,
  timestamp,
} from "../src/lib.ts";

test("settings defaults and invalid field fallback agree with the schema", () => {
  const defaults = schemaDefaults(schema.fields);
  assert.deepEqual(
    parseSettings(schema.fields, { version: 1, values: {} }),
    defaults,
  );
  const invalid = Object.fromEntries(
    Object.keys(schema.fields).map((key) => [key, []]),
  );
  assert.deepEqual(
    parseSettings(schema.fields, { version: 1, values: invalid }),
    defaults,
  );
  assert.throws(() =>
    parseSettings(schema.fields, { version: 999, values: {} }),
  );
  assert.throws(() =>
    parseSettings(schema.fields, { version: 1, values: null }),
  );
});
test("HTTP source rejects unsupported schemes, credentials and whitespace", () => {
  for (const bad of [
    "",
    "file:///tmp/data",
    "ftp://example.com",
    "http://user:password@example.com",
    "https://example.com/a b",
  ])
    assert.throws(() => url(bad));
  assert.equal(
    url("https://example.com/feed?limit=1"),
    "https://example.com/feed?limit=1",
  );
});
test("timestamps are validated and object parsing does not accept arrays", () => {
  assert.equal(timestamp("2026-01-01T00:00:00Z"), Date.UTC(2026, 0, 1));
  assert.throws(() => timestamp("not a date"));
  assert.deepEqual(record([]), {});
});
