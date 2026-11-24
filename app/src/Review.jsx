import React from "react";
import { amount } from "./model.mjs";

const methodNames = {
  last: "Последний доступный уровень", recent: "Последний годовой темп",
  adaptive: "Сглаженный темп", seasonal: "Уровень год назад", market: "Общий рост",
  low_base: "Минимальная база", last_delta: "Прирост в рублях",
};

export function Review({ data }) {
  const december = data.benchmark.filter(row => row.target === "2024-12" && row.mae);
  return <div className="review-layout">
    <section className="surface">
      <div className="section-heading">
        <h2>Совпадения с фактической тройкой</h2>
        <p>Сравнение при одинаковом пороге и на общих месяцах. Лидеры определяются по годовому росту внутри допустимого пула.</p>
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
