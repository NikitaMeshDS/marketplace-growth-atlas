import React from "react";
import { ChevronDown } from "lucide-react";
import { amount, regionalResult } from "./model.mjs";

const methodNames = {
  last: "Последний доступный уровень", recent: "Последний годовой темп",
  adaptive: "Сглаженный темп", seasonal: "Уровень год назад", market: "Общий рост",
  low_base: "Минимальная база", last_delta: "Прирост в рублях",
};

const count = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const evidence = "https://github.com/NikitaMeshDS/marketplace-growth-atlas/blob/main/evidence/";

function RegionalReview({ rows, regions, floor, cohort, onChange }) {
  const result = regionalResult(rows, cohort, floor);
  if (!result) return null;
  const [signal, strongest] = result.methods;
  const floors = [...new Set(rows.map(row => Number(row.floor)))].sort((a, b) => a - b);

  return <section className="surface review-wide regional-review" aria-labelledby="regional-title">
    <div className="section-heading">
      <h2 id="regional-title">Отбор внутри субъектов РФ</h2>
      <p>Попадания в тройку по фактическому годовому росту расходов. Май–декабрь 2024 года.</p>
    </div>
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
    </div>
    <div className="regional-grid">
      <div className="regional-headline" aria-live="polite">
        <span>Сигнал роста</span>
        <strong>{percent.format(signal.hits / result.slots)}</strong>
        <span>{count.format(signal.hits)} из {count.format(result.slots)} мест в тройках</span>
        <p>По {count.format(result.slices)} срезам «субъект — месяц»{floor === 2000 && cohort === "all" && ` в ${regions} субъектах`}.</p>
      </div>
      <ul className="regional-bars" aria-label="Попадания в фактические тройки по правилам отбора">
        {result.methods.map(method => <li className={method.id === signal.id ? "regional-signal" : ""} key={method.id}>
          <span>{method.name}</span>
          <strong>{count.format(method.hits)} <small>· {percent.format(method.hits / result.slots)}</small></strong>
          <div className="regional-track" aria-hidden="true">
            <span style={{ width: `${method.hits / result.slots * 100}%` }}/>
          </div>
        </li>)}
      </ul>
    </div>
    <p className="regional-difference">Разница с лучшим из четырёх других правил ({strongest.name.toLowerCase()}) — {result.lead > 0 ? "+" : ""}{count.format(result.lead)} попаданий.</p>
    <p className="inline-note">В каждом срезе сравнивается один и тот же пул из 10 и более кандидатов с известными итогами. При смене порога пул и фактическая тройка пересчитываются.</p>
    <div className="regional-sources">
      <a href={evidence + "regional-coverage.csv"}>Данные по субъектам и месяцам</a>
      <a href={evidence + "regional-floor-comparison.csv"}>Сводка по порогам</a>
    </div>
  </section>;
}

export function Review({ data, floor, cohort, onChange }) {
  const december = data.benchmark.filter(row => row.target === "2024-12" && row.mae);
  return <div className="review-layout">
    <RegionalReview rows={data.regional} regions={data.reviewedRegions} floor={floor} cohort={cohort} onChange={onChange}/>
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
