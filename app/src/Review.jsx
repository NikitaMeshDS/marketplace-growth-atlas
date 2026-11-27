import React from "react";
import { ChevronDown } from "lucide-react";
import { amount, regionalMonthResult, regionalResult } from "./model.mjs";

const methodNames = {
  last: "Последний доступный уровень", recent: "Последний годовой темп",
  adaptive: "Сглаженный темп", seasonal: "Уровень год назад", market: "Общий рост",
  low_base: "Минимальная база", last_delta: "Прирост в рублях",
};

const count = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const evidence = "https://github.com/NikitaMeshDS/marketplace-growth-atlas/blob/main/evidence/";

const month = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });

function MonthlyReview({ rows, objective }) {
  const results = rows.map(row => regionalMonthResult(row, objective));
  const leader = results[0].leader.name;
  const wins = results.filter(row => row.leader.hits > row.alternative.hits).length;
  return <details className="monthly-review">
    <summary>Сравнение по месяцам</summary>
    <p className="inline-note">{rows[0].slices} субъекта с полными данными, порог 2 000 ₽ на жителя.
      В каждом месяце сравниваем {rows[0].slots} мест в тройках.</p>
    <p className="monthly-result">«{leader}» опередил остальные правила в {wins} из {results.length} месяцев.</p>
    <table aria-label="Попадания в тройку по месяцам">
      <thead><tr><th scope="col">Месяц</th><th scope="col">{leader}</th><th scope="col">Лучшее из остальных правил</th></tr></thead>
      <tbody>{results.map(({ target, leader, alternative }) => <tr key={target}>
        <th className="month-label" scope="row">{month.format(new Date(`${target}-01T00:00:00Z`))}</th>
        <td className={leader.hits > alternative.hits ? "highlight" : undefined}>{leader.hits}</td>
        <td><strong className={alternative.hits > leader.hits ? "highlight" : undefined}>{alternative.hits}</strong>
          <small>{alternative.name}</small></td>
      </tr>)}</tbody>
    </table>
    <a href={evidence + "regional-by-month.csv"}>Открыть полную таблицу CSV</a>
  </details>;
}

function RegionalReview({ rows, monthly, rubleResult, regions, floor, cohort, objective, onChange }) {
  const rubles = objective === "rubles";
  const result = rubles ? rubleResult : regionalResult(rows, cohort, floor);
  if (!result) return null;
  const [signal, strongest] = result.methods;
  const winner = result.lead < 0 ? strongest : signal;
  const methods = result.lead < 0
    ? [...result.methods].sort((a, b) => b.hits - a.hits)
    : result.methods;
  const floors = [...new Set(rows.map(row => Number(row.floor)))].sort((a, b) => a - b);

  return <section className="surface review-wide regional-review" aria-labelledby="regional-title">
    <div className="section-heading">
      <h2 id="regional-title">Отбор внутри субъектов РФ</h2>
      <p>Попадания в фактические тройки. Май–декабрь 2024 года.</p>
    </div>
    {rubleResult && <div className="regional-objective" role="group" aria-label="Критерий фактической тройки">
      <button type="button" aria-pressed={!rubles} onClick={() => onChange({ reviewObjective: "percent" })}>
        Рост в процентах
      </button>
      <button type="button" aria-pressed={rubles} onClick={() => onChange({ reviewObjective: "rubles" })}>
        Прирост в рублях
      </button>
    </div>}
    {rubles ? <p className="regional-scope">Порог 2 000 ₽ на жителя. На {count.format(result.slices)} срезах фактические тройки определены по годовому приросту в рублях на жителя.</p> :
    <div className="regional-controls">
      <label className="form-field" htmlFor="regional-floor"><span>Порог расходов год назад</span>
        <div className="select-wrap">
          <select id="regional-floor" value={floor} onChange={event => onChange({ reviewFloor: Number(event.target.value) })}>
            {floors.map(value => <option key={value} value={value}>{value ? amount(value) : "Без порога"}</option>)}
          </select><ChevronDown size={16} aria-hidden="true"/>
        </div>
      </label>
      <label className="form-field" htmlFor="regional-cohort"><span>Срезы для сравнения</span>
        <div className="select-wrap">
          <select id="regional-cohort" value={cohort} onChange={event => onChange({ reviewCohort: event.target.value })}>
            <option value="all">Все срезы при этом пороге</option>
            <option value="common">Одни и те же срезы для всех порогов</option>
          </select><ChevronDown size={16} aria-hidden="true"/>
        </div>
      </label>
    </div>}
    <div className="regional-grid">
      <div className="regional-headline" aria-live="polite">
        <span>{winner.name}</span>
        <strong>{percent.format(winner.hits / result.slots)}</strong>
        <span>{count.format(winner.hits)} из {count.format(result.slots)} мест в тройках</span>
        <p>По {count.format(result.slices)} срезам «субъект — месяц»{(rubles || (floor === 2000 && cohort === "all")) && ` в ${regions} субъектах`}.</p>
      </div>
      <ul className="regional-bars" aria-label="Попадания в фактические тройки по правилам отбора">
        {methods.map(method => <li className={method.id === winner.id ? "regional-leader" : ""} key={method.id}>
          <span>{method.name}</span>
          <strong>{count.format(method.hits)} <small>· {percent.format(method.hits / result.slots)}</small></strong>
          <div className="regional-track" aria-hidden="true">
            <span style={{ width: `${method.hits / result.slots * 100}%` }}/>
          </div>
        </li>)}
      </ul>
    </div>
    <p className="regional-difference">{winner.id !== signal.id
      ? `На ${count.format(-result.lead)} больше, чем у сигнала роста.`
      : `Разница с лучшим из четырёх других правил (${strongest.name.toLowerCase()}) — ${result.lead > 0 ? "+" : ""}${count.format(result.lead)} попаданий.`}</p>
    <p className="inline-note">{rubles
      ? "Списки кандидатов остаются прежними. Меняется правило, по которому определяются фактические лидеры."
      : "В каждом срезе сравнивается один и тот же пул из 10 и более кандидатов с известными итогами. При смене порога пул и фактическая тройка пересчитываются."}</p>
    {monthly.length > 0 && <MonthlyReview rows={monthly} objective={objective}/>}
    <div className="regional-sources">
      <a href={evidence + "regional-coverage.csv"}>Данные по субъектам и месяцам</a>
      <a href={evidence + "regional-floor-comparison.csv"}>Сводка по порогам</a>
      <a href={evidence + "regional-objectives.csv"}>Сравнение двух целей</a>
    </div>
  </section>;
}

export function Review({ data, floor, cohort, objective, onChange }) {
  const december = data.benchmark.filter(row => row.target === "2024-12" && row.mae);
  return <div className="review-layout">
    <RegionalReview rows={data.regional} monthly={data.monthly} rubleResult={data.rubleRegional} regions={data.reviewedRegions}
      floor={floor} cohort={cohort} objective={objective} onChange={onChange}/>
    <section className="surface">
      <div className="section-heading">
        <h2>Отбор по общей выборке</h2>
        <p>Здесь тройка определяется по общему пулу муниципалитетов. Правила сравниваются при одинаковом пороге и на общих месяцах.</p>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Минимум</th><th>Месяцы</th><th>Сигнал</th><th>Низкая база</th><th>Прирост в ₽</th></tr></thead>
          <tbody>{data.comparisons.map(row => <tr key={row.floor}>
            <th scope="row">{amount(Number(row.floor))}</th><td>{row.months}</td>
            <td className="highlight">{row.last_hits} из {row.slots}</td>
            <td>{row.low_base_hits} из {row.slots}</td><td>{row.absolute_delta_hits} из {row.slots}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="surface">
      <div className="section-heading"><h2>Ошибка прогноза в декабре</h2><p>Средняя абсолютная ошибка в рублях на жителя.</p></div>
      <ul className="metrics">{december.map(row => <li key={row.method}>
        <span>{methodNames[row.method]}</span><strong>{amount(Number(row.mae))}</strong>
      </li>)}</ul>
    </section>
    <section className="surface review-wide">
      <div className="section-heading"><h2>Декабрьская проверка без порога</h2>
        <p>Список построен по данным до октября. Фактические расходы известны у {Number(data.history[0].observed_count).toLocaleString("ru-RU")} территорий.</p></div>
      <div className="table-scroll"><table>
        <thead><tr><th>Территория</th><th>Факт на жителя</th><th>Место по росту</th><th>Место по сумме</th></tr></thead>
        <tbody>{data.history.map(row => <tr key={row.territory_id}>
          <th scope="row">{row.name}<small>{row.region_name}</small></th>
          <td>{amount(Number(row.actual))}</td><td>{Number(row.actual_growth_rank)}</td>
          <td>{Number(row.actual_level_rank)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="evidence-note review-wide">
      <h2>Как читать результат</h2>
      <p>Данные относятся к архиву 2023–2024 годов. Порог и география меняют состав кандидатов. Сигнал оценивает динамику расходов жителей, а эффект кампании предстоит измерить на данных продавца.</p>
    </section>
  </div>;
}
