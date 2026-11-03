import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { UsageMeter } from "./usage.ts";

const T0 = Date.UTC(2026, 10, 2, 14, 30, 0);

test("counts calls per key per tool for the current hour and day", () => {
  const meter = new UsageMeter();
  const rec = (time: number, key: string, tool: string, status = 200) =>
    meter.record({
      time,
      key,
      tool,
      surface: "rest",
      status,
      durationMs: 2,
    });
  rec(T0, "tenant-a", "calc_debt_sizing");
  rec(T0 + 1, "tenant-a", "calc_debt_sizing", 400);
  rec(T0 + 2, "tenant-a", "id_parcel");
  rec(T0 - 3_600_000, "tenant-a", "id_parcel"); // previous hour, same day
  rec(T0 - 86_400_000, "tenant-a", "id_parcel"); // yesterday
  rec(T0, "tenant-b", "calc_debt_sizing");

  const all = meter.report(T0 + 5);
  assert.equal(all.key, null);
  assert.equal(all.hour.start, "2026-11-02T14:00:00.000Z");
  assert.equal(all.hour.end, "2026-11-02T15:00:00.000Z");
  assert.equal(all.day.start, "2026-11-02T00:00:00.000Z");
  assert.equal(all.day.end, "2026-11-03T00:00:00.000Z");
  assert.deepEqual(all.hour.keys["tenant-a"], {
    calls: 3,
    errors: 1,
    duration_ms: 6,
    tools: {
      calc_debt_sizing: { calls: 2, errors: 1, duration_ms: 4 },
      id_parcel: { calls: 1, errors: 0, duration_ms: 2 },
    },
  });
  assert.equal(all.day.keys["tenant-a"]?.calls, 4);
  assert.equal(all.day.keys["tenant-a"]?.tools.id_parcel?.calls, 2);
  assert.equal(all.hour.keys["tenant-b"]?.calls, 1);

  const one = meter.report(T0 + 5, "tenant-b");
  assert.equal(one.key, "tenant-b");
  assert.deepEqual(Object.keys(one.hour.keys), ["tenant-b"]);
  assert.deepEqual(meter.report(T0, "nobody").day.keys, {});
});

test("old hour buckets are pruned", () => {
  const meter = new UsageMeter({ retainHours: 2 });
  const rec = (time: number) =>
    meter.record({
      time,
      key: "k",
      tool: "t",
      surface: "mcp",
      status: 200,
      durationMs: 0,
    });
  rec(T0 - 3 * 3_600_000);
  assert.equal(meter.report(T0 - 3 * 3_600_000).hour.keys.k?.calls, 1);
  rec(T0);
  assert.equal(meter.report(T0 - 3 * 3_600_000).hour.keys.k, undefined);
  assert.equal(meter.report(T0).hour.keys.k?.calls, 1);
});

test("appends one JSON line per call to the usage log", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "factlot-usage-")), "u.jsonl");
  const meter = new UsageMeter({ file });
  meter.record({
    time: T0,
    key: "tenant-a",
    tool: "calc_debt_sizing",
    surface: "rest",
    status: 200,
    durationMs: 3,
  });
  meter.record({
    time: T0 + 1,
    key: "tenant-b",
    tool: "mcp:tools/list",
    surface: "mcp",
    status: 429,
    durationMs: 0,
  });
  await meter.flush();
  const lines = readFileSync(file, "utf8").split("\n");
  assert.equal(lines.length, 3, "two lines, each newline-terminated");
  assert.equal(lines[2], "");
  assert.deepEqual(JSON.parse(lines[0] ?? ""), {
    time: "2026-11-02T14:30:00.000Z",
    key: "tenant-a",
    tool: "calc_debt_sizing",
    surface: "rest",
    status: 200,
    duration_ms: 3,
  });
  assert.equal(JSON.parse(lines[1] ?? "").surface, "mcp");
});
