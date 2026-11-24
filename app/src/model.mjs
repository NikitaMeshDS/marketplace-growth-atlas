const rubles = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export const amount = (value) => `${rubles.format(value)} ₽`;
export const signed = (value) => `${value > 0 ? "+" : ""}${decimals.format(value * 100)}%`;

export function shortlist(data, region, floor) {
  const eligible = data.filter(row => (!region || row.region === region) && row.base >= floor);
  eligible.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"));
  return { count: eligible.length, rows: eligible.slice(0, 3) };
}

export function orderThreshold(budget, margin) {
  const spend = Number(budget);
  const contribution = Number(margin);
  if (![spend, contribution].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  return {
    breakEven: Math.ceil(spend / contribution),
    profitable: Math.floor(spend / contribution) + 1,
  };
}

export function csvText(rows) {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const lines = rows.map(row => [
    row.id, quote(row.name), quote(row.region), row.base, row.last,
    (row.score * 100).toFixed(1).replace(".", ","),
  ].join(";"));
  return "\uFEFF" + ["Код;Муниципалитет;Субъект;Декабрь 2023;Октябрь 2024;Сигнал роста (%)", ...lines].join("\r\n");
}
