const rubles = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const decisionPrefix = "atlas-candidate-v1:";

export const decisionStatuses = {
  pending: "Не оценён",
  review: "Проверить дальше",
  excluded: "Исключён",
  "needs-data": "Нужны данные",
};
export const pilotChecks = {
  delivery: "Адрес и срок доставки",
  stock: "Наличие товара",
  ads: "Доступная зона показа",
};
const regionalMethods = {
  signal_hits: "Сигнал роста",
  absolute_delta_hits: "Прирост в рублях",
  low_base_hits: "Низкая прошлогодняя база",
  recent_growth_hits: "Последний годовой темп",
  adaptive_growth_hits: "Сглаженный темп",
};

function rankRegionalMethods(row) {
  const methods = Object.entries(regionalMethods)
    .map(([id, name]) => ({ id, name, hits: Number(row[id]) }));
  const [signal, ...alternatives] = methods;
  alternatives.sort((a, b) => b.hits - a.hits);
  return {
    slices: Number(row.slices), slots: Number(row.slots),
    methods: [signal, ...alternatives], lead: signal.hits - alternatives[0].hits,
  };
}

export function regionalResult(rows, cohort, floor) {
  const row = rows.find(item => item.cohort === cohort && Number(item.floor) === floor);
  return row ? rankRegionalMethods(row) : null;
}

export function rubleRegionalResult(rows) {
  if (!rows.length) return null;
  const totals = Object.fromEntries(Object.keys(regionalMethods).map(id => [
    id, rows.reduce((sum, row) => sum + Number(row[`ruble_target_${id}`]), 0),
  ]));
  return rankRegionalMethods({ ...totals, slices: rows.length, slots: rows.length * 3 });
}
function normalizeDecision(value) {
  return {
    status: Object.hasOwn(decisionStatuses, value?.status) ? value.status : "pending",
    reason: typeof value?.reason === "string" ? value.reason.slice(0, 500) : "",
    checks: Object.fromEntries(Object.keys(pilotChecks).map(key => [key, value?.checks?.[key] === true])),
  };
}

function readDecision(storage, key, fallback) {
  try {
    return normalizeDecision(JSON.parse(storage?.getItem(key) ?? "null") ?? fallback);
  } catch {
    return normalizeDecision(fallback);
  }
}

export function loadDecisions(storage) {
  const entries = [];
  try {
    for (let index = 0; index < (storage?.length ?? 0); index++) {
      const key = storage.key(index);
      if (key?.startsWith(decisionPrefix)) {
        entries.push([key.slice(decisionPrefix.length), readDecision(storage, key)]);
      }
    }
  } catch {
    // The browser may block access to local storage.
  }
  return Object.fromEntries(entries);
}

export function saveDecision(storage, id, patch, fallback) {
  const key = decisionPrefix + id;
  const previous = readDecision(storage, key, fallback);
  const decision = normalizeDecision({ ...previous, ...patch, checks: { ...previous.checks, ...patch.checks } });
  try {
    storage?.setItem(key, JSON.stringify(decision));
    return { decision, saved: !!storage };
  } catch {
    return { decision, saved: false };
  }
}

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

export function csvText(rows, decisions = {}) {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const headers = [
    "Код", "Муниципалитет", "Субъект", "Декабрь 2023", "Октябрь 2024", "Сигнал роста (%)",
    "Статус", "Причина", ...Object.values(pilotChecks),
  ];
  const lines = rows.map(row => {
    const { status, reason, checks } = normalizeDecision(decisions[row.id]);
    const safeReason = /^(?:\s*[=+\-@]|[\t\r\n])/u.test(reason) ? "'" + reason : reason;
    return [
      row.id, quote(row.name), quote(row.region), row.base, row.last,
      (row.score * 100).toFixed(1).replace(".", ","),
      quote(decisionStatuses[status]), quote(safeReason),
      ...Object.keys(pilotChecks).map(key => quote(checks[key] ? "Подтверждено" : "Не отмечено")),
    ].join(";");
  });
  return "\uFEFF" + [headers.join(";"), ...lines].join("\r\n");
}
