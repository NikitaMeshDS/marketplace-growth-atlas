import test from "node:test";
import assert from "node:assert/strict";
import { shortlist, orderThreshold, csvText } from "../src/model.mjs";

const rows = [
  { id: "11", region: "A", base: 2500, score: 1.1 },
  { id: "12", region: "B", base: 2200, score: 0.9 },
  { id: "10", region: "A", base: 1500, score: 2.1 },
  { id: "01", region: "A", base: 2400, score: 1.1 },
];

test("filtering is applied before ranking and ties use the territory ID", () => {
  const result = shortlist(rows, "A", 2000);
  assert.equal(result.count, 2);
  assert.deepEqual(result.rows.map(row => row.id), ["01", "11"]);
  assert.equal(shortlist(rows, "B", 3000).rows.length, 0);
});

test("break-even and profitable order counts differ at an exact split", () => {
  assert.deepEqual(orderThreshold("6000", "300"), { breakEven: 20, profitable: 21 });
  assert.deepEqual(orderThreshold("6001", "300"), { breakEven: 21, profitable: 21 });
  assert.equal(orderThreshold("", "300"), null);
  assert.equal(orderThreshold("6000", "0"), null);
});

test("csv exports quotes and encodes Russian captions in a spreadsheet-friendly format", () => {
  const value = csvText([{ id: "5", name: 'Край "А"', region: "Москва", base: 2000, last: 3000, score: 0.5 }]);
  assert.ok(value.startsWith("\uFEFF"));
  assert.match(value, /"Край ""А"""/u);
  assert.match(value, /2000;3000;50,0/u);
});
