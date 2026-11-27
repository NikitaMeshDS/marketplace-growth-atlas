import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { shortlist, orderThreshold, csvText, loadDecisions, saveDecision, regionalResult, rubleRegionalResult } from "../src/model.mjs";
import { decodeRoute, encodeRoute } from "../src/route.mjs";

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

test("saving a new territory or an individual check preserves earlier decisions after reload", () => {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  saveDecision(storage, "11", { status: "review", reason: "Уточнить срок", checks: { stock: true } });
  saveDecision(storage, "12", { status: "excluded", reason: "Нет доставки" });
  saveDecision(storage, "11", { checks: { delivery: true } });
  assert.deepEqual(loadDecisions(storage), {
    11: { status: "review", reason: "Уточнить срок", checks: { delivery: true, stock: true, ads: false } },
    12: { status: "excluded", reason: "Нет доставки", checks: { delivery: false, stock: false, ads: false } },
  });
  assert.equal(saveDecision(null, "11", { reason: "Офлайн" }, loadDecisions(storage)["11"]).decision.status, "review");
});

test("export pairs each row with its decision, retains multiline notes and treats formulas as text", () => {
  const report = parse(csvText(rows, {
    11: { status: "review", reason: '=1+1; "срок"\nДо пятницы', checks: { delivery: true } },
    12: { status: "excluded", reason: "Нет доставки" },
  }), { bom: true, columns: true, delimiter: ";" });
  assert.equal(report[0]["Статус"], "Проверить дальше");
  assert.equal(report[0]["Причина"], '\'=1+1; "срок"\nДо пятницы');
  assert.equal(report[0]["Адрес и срок доставки"], "Подтверждено");
  assert.equal(report[0]["Наличие товара"], "Не отмечено");
  assert.equal(report[1]["Причина"], "Нет доставки");
  assert.equal(report[2]["Статус"], "Не оценён");
});

test("the regional comparison uses the requested cohort, denominator and best alternative", () => {
  const results = [
    { cohort: "all", floor: "2000", slices: "432", slots: "1296", signal_hits: "743",
      absolute_delta_hits: "553", low_base_hits: "557", recent_growth_hits: "551", adaptive_growth_hits: "547" },
    { cohort: "common", floor: "2000", slices: "266", slots: "798", signal_hits: "463",
      absolute_delta_hits: "348", low_base_hits: "359", recent_growth_hits: "340", adaptive_growth_hits: "330" },
  ];
  const all = regionalResult(results, "all", 2000);
  assert.equal(all.slots, 1296);
  assert.equal(all.methods[0].hits, 743);
  assert.equal(all.methods[1].id, "low_base_hits");
  assert.equal(all.lead, 186);
  const paired = regionalResult(results, "common", 2000);
  assert.equal(paired.slices, 266);
  assert.equal(paired.slots, 798);
  assert.equal(paired.methods[0].hits, 463);
  assert.equal(paired.lead, 104);
  assert.equal(regionalResult(results, "all", 3000), null);
});

test("the ruble objective totals the paired slices and can favor another rule", () => {
  const row = {
    signal_hits: "3", ruble_target_signal_hits: "1", ruble_target_absolute_delta_hits: "2",
    ruble_target_low_base_hits: "0", ruble_target_recent_growth_hits: "1",
    ruble_target_adaptive_growth_hits: "0",
  };
  const result = rubleRegionalResult([row, row]);
  assert.equal(result.slices, 2);
  assert.equal(result.slots, 6);
  assert.equal(result.methods[0].hits, 2);
  assert.equal(result.methods[1].id, "absolute_delta_hits");
  assert.equal(result.methods[1].hits, 4);
  assert.equal(result.lead, -2);
  assert.equal(rubleRegionalResult([]), null);
});

test("a public link round-trips the scenario and review filters without private fields", () => {
  const regions = ["Красноярский край"];
  const route = {
    tab: "pilot", region: regions[0], floor: 2000, selectedId: "708",
    reviewFloor: 3000, reviewCohort: "common", reviewObjective: "rubles",
  };
  const hash = encodeRoute({ ...route, reason: "личная заметка", budget: "9173" });
  assert.equal(hash.includes("9173"), false);
  assert.equal(new URLSearchParams(hash.slice(1)).has("reason"), false);
  assert.deepEqual(decodeRoute(hash, regions), route);
});

test("unknown URL values fall back to the standard demo", () => {
  const invalid = "#section=menu&region=unknown&floor=1234&candidate=broken&review-floor=0x0&cohort=custom";
  const regions = ["Красноярский край"];
  assert.deepEqual(decodeRoute(invalid, regions), decodeRoute("", regions));
  assert.equal(decodeRoute("#section=review&floor=0&review-floor=0", regions).reviewFloor, 0);
  assert.equal(encodeRoute(decodeRoute("", regions)), "");
});
