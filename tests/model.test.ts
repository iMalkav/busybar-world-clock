import assert from "node:assert/strict";
import test from "node:test";
import schema from "../src/appmeta/settings.json" with { type: "json" };
import { AppModel } from "../src/model.ts";
import { schemaDefaults, type Settings } from "../src/lib.ts";
const NOW = 1700000000000;
const make = (values: Settings = {}, saved: Settings = {}, now = NOW) =>
  new AppModel({ ...schemaDefaults(schema.fields), ...values }, saved, now);

test("fractional offsets cross the UTC date boundary", () => {
  const a = make({ clocks: "Nepal=345" });
  const n = Date.UTC(2026, 0, 1, 20, 30);
  assert.equal(a.view(n).value, "02:15:00");
  assert.equal(a.view(n).rows?.[0], "2026-01-02");
});
test("invalid clock entries fall back and selection persists", () => {
  const a = make({ clocks: "Bad=no;Far=9999" });
  assert.equal(a.clocks.length, 1);
  const b = make();
  b.key("wheel", 1, NOW);
  assert.equal(make({}, b.save()).selected, 1);
});
