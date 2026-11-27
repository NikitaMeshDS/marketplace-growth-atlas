import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, ChartNoAxesColumnIncreasing,
  ChevronDown, FlaskConical, Link2, Map, MapPin, RotateCcw, MapPinned, SlidersHorizontal,
} from "lucide-react";
import atlas from "atlas-evidence";
import "@fontsource-variable/manrope";
import "./style.css";
import {
  amount, csvText, decisionStatuses, loadDecisions, orderThreshold, pilotChecks, saveDecision, shortlist, signed,
} from "./model.mjs";
import { TerritoryMap } from "./TerritoryMap.jsx";
import { Review } from "./Review.jsx";
import { decodeRoute, defaultFloor, encodeRoute, floors } from "./route.mjs";

const sections = [
  { key: "atlas", label: "Территории", icon: Map },
  { key: "pilot", label: "План пилота", icon: FlaskConical },
  { key: "review", label: "Проверка", icon: ChartNoAxesColumnIncreasing },
];
const pageTitles = {
  atlas: ["Где тестировать продвижение", "Отберите территории по динамике расходов жителей на маркетплейсах."],
  pilot: ["План пробной кампании", "Проверьте доставку и зону показа, затем рассчитайте порог окупаемости."],
  review: ["Проверка на истории", "Посмотрите, как фильтры влияют на результат и что показало сравнение методов."],
};
const regions = [...new Set(atlas.candidates.map(row => row.region))].sort((a, b) => a.localeCompare(b, "ru"));
const checks = Object.entries(pilotChecks);

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function Select({ id, label, children, ...props }) {
  return <label className="form-field" htmlFor={id}><span>{label}</span>
    <div className="select-wrap"><select id={id} {...props}>{children}</select><ChevronDown size={16}/></div>
  </label>;
}

function download(rows, decisions) {
  const url = URL.createObjectURL(new Blob([csvText(rows, decisions)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "atlas-shortlist.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CandidateList({ rows, count, selected, decisions, onSelect, onPilot }) {
  return <section className="shortlist-panel" aria-labelledby="shortlist-title">
    <div className="shortlist-head">
      <h2 id="shortlist-title">Список кандидатов</h2>
      <span>{rows.length} из {count.toLocaleString("ru-RU")}</span>
    </div>
    {rows.length === 0 && <p className="empty">В этой выборке нет территорий. Измените субъект или снизьте порог расходов.</p>}
    <ol className="candidate-list">{rows.map((row, index) => <li key={row.id}>
      <button className={`candidate ${selected?.id === row.id ? "active" : ""}`}
        onClick={() => onSelect(row.id)} aria-pressed={selected?.id === row.id}>
        <span className="candidate-number">{index + 1}</span>
        <span className="candidate-name">
          <strong>{row.name}</strong><small>{row.region}</small>
          {decisions[row.id]?.status && decisions[row.id].status !== "pending" &&
            <small className="candidate-status">{decisionStatuses[decisions[row.id].status]}</small>}
        </span>
        <span className="candidate-score">{signed(row.score)}</span>
      </button>
    </li>)}</ol>
    {selected && <div className="candidate-detail">
      <div className="mini-metric"><span>Декабрь 2023</span><strong>{amount(selected.base)}</strong></div>
      <div className="mini-metric"><span>Октябрь 2024</span><strong>{amount(selected.last)}</strong></div>
      <p>Сигнал роста: отношение расходов октября 2024 года к расходам декабря 2023 года, минус единица.</p>
      <button className="button primary full" onClick={onPilot}>Рассчитать пилот <ArrowRight size={17}/></button>
    </div>}
  </section>;
}

function Pilot({ rows, selected, decision, storageFailed, onDecision, onSelect, onBack }) {
  const [budget, setBudget] = useState("6000");
  const [margin, setMargin] = useState("300");
  const confirmed = checks.filter(([key]) => decision?.checks[key]).length;
  const threshold = orderThreshold(budget, margin);
  if (!selected) return <section className="surface empty">
    <h2>Выберите территорию</h2><p>Расчёт пилота начинается со списка кандидатов.</p>
    <button className="button secondary" onClick={onBack}><ArrowLeft size={17}/> К территориям</button>
  </section>;
  return <div className="pilot-layout">
    <section className="surface pilot-inputs">
      <div className="section-heading"><h2>Условия кампании</h2><p>Учебный товар: органайзер для кабелей, схема FBS.</p></div>
      <Select id="pilot-territory" label="Территория" value={selected.id} onChange={e => onSelect(e.target.value)}>
        {rows.map(row => <option key={row.id} value={row.id}>{row.name}, {row.region}</option>)}
      </Select>
      <div className="center"><MapPin size={18}/><div><strong>{selected.center || selected.region}</strong><small>
        {selected.center ? "Справочный центр для проверки адреса доставки" : "Населённый пункт уточняет продавец"}</small></div></div>
      <div className="input-grid">
        <label className="form-field" htmlFor="budget"><span>Бюджет, ₽</span><input id="budget" type="number" min="1" step="1"
          value={budget} onChange={e => setBudget(e.target.value)}/></label>
        <label className="form-field" htmlFor="margin"><span>Маржа на заказ, ₽</span><input id="margin" type="number" min="1" step="1"
          value={margin} onChange={e => setMargin(e.target.value)}/></label>
      </div>
      <p className="inline-note">Маржа на выкупленный заказ после переменных затрат, до рекламы.</p>
      <fieldset className="checklist"><legend>Проверки перед запуском</legend>
        {checks.map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={decision?.checks[key] ?? false}
            onChange={e => onDecision(selected.id, { checks: { [key]: e.target.checked } })}/>{label}
        </label>)}
      </fieldset>
      <div className="pilot-decision">
        <Select id="decision-status" label="Статус кандидата" value={decision?.status ?? "pending"}
          onChange={e => onDecision(selected.id, { status: e.target.value })}>
          {Object.entries(decisionStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <label className="form-field" htmlFor="decision-reason"><span>Причина решения</span>
          <textarea id="decision-reason" rows={2} maxLength={500} value={decision?.reason ?? ""}
            onChange={e => onDecision(selected.id, { reason: e.target.value })}/>
        </label>
        <p className="inline-note" role={storageFailed ? "status" : undefined}>
          {storageFailed ? "Сохранение в браузере недоступно. Выгрузите список, чтобы сохранить отметки." :
            "Отметки сохраняются для этой территории в текущем браузере."}
        </p>
      </div>
    </section>
    <section className="pilot-result">
      <h2>Экономика пилота</h2>
      <div className="pilot-kpis">
        <div><strong>{threshold?.breakEven ?? "—"}</strong><span>заказов для покрытия бюджета</span></div>
        <div><strong>{threshold?.profitable ?? "—"}</strong><span>заказов для положительной прибыли</span></div>
      </div>
      <div className="pilot-status" role="status">{!threshold ? "Введите целые положительные суммы бюджета и маржи." :
        confirmed === checks.length ? "Все условия отмечены." :
        `Проверено условий: ${confirmed} из ${checks.length}`}</div>
      <p>Для реальной кампании сверяйте товар, адрес доставки и географию показов в кабинете продавца.</p>
    </section>
  </div>;
}

function App() {
  const [route, setRoute] = useState(() => decodeRoute(window.location.hash, regions));
  const { tab, region, floor, selectedId, reviewFloor, reviewCohort, reviewObjective } = route;
  const [shareStatus, setShareStatus] = useState("");
  const [storage] = useState(browserStorage);
  const [decisions, setDecisions] = useState(() => loadDecisions(storage));
  const [storageFailed, setStorageFailed] = useState(!storage);
  const { rows, count } = useMemo(() => shortlist(atlas.candidates, region, floor), [region, floor]);
  const selected = rows.find(row => row.id === selectedId) ?? rows[0];
  const [title, subtitle] = pageTitles[tab];

  useEffect(() => {
    function syncRoute() {
      setRoute(decodeRoute(window.location.hash, regions));
      setShareStatus("");
    }
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (storageFailed) return;
    function syncDecisions(event) {
      if (event.storageArea === storage) setDecisions(loadDecisions(storage));
    }
    window.addEventListener("storage", syncDecisions);
    return () => window.removeEventListener("storage", syncDecisions);
  }, [storage, storageFailed]);

  function updateRoute(patch, addToHistory = false) {
    const next = { ...route, ...patch };
    const url = new URL(window.location.href);
    url.hash = encodeRoute(next);
    if (url.href !== window.location.href) {
      if (addToHistory) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    }
    setRoute(next);
    setShareStatus("");
  }

  function move(next) {
    updateRoute({ tab: next }, true);
    window.scrollTo(0, 0);
  }

  async function copyLink() {
    const url = new URL(window.location.href);
    const sharedRoute = tab === "review"
      ? { tab, floor: defaultFloor, reviewFloor: reviewObjective === "rubles" ? defaultFloor : reviewFloor,
        reviewCohort: reviewObjective === "rubles" ? "all" : reviewCohort, reviewObjective }
      : { tab, region, floor, selectedId: selected?.id, reviewFloor: defaultFloor };
    url.hash = encodeRoute(sharedRoute);
    try {
      await navigator.clipboard.writeText(url.href);
      setShareStatus("Ссылка скопирована.");
    } catch {
      setShareStatus("Скопируйте адрес из строки браузера.");
    }
  }

  function selectCandidate(id) {
    updateRoute({ selectedId: id });
  }

  function record(id, patch) {
    const { decision, saved } = saveDecision(storageFailed ? null : storage, id, patch, decisions[id]);
    setDecisions(current => ({ ...current, [id]: decision }));
    setStorageFailed(!saved);
  }

  return <>
    <header className="topbar"><div className="topbar-inner">
      <button className="brand" aria-label="Атлас спроса, главная" onClick={() => move("atlas")}>
        <span className="brand-mark"><MapPinned size={23} strokeWidth={2.2}/></span>
        <span>Атлас спроса</span>
      </button>
      <nav aria-label="Разделы">{sections.map(({ key, label, icon: Icon }) =>
        <button key={key} aria-current={tab === key ? "page" : undefined} className={tab === key ? "nav-active" : ""}
          onClick={() => move(key)}><Icon size={17}/>{label}</button>)}</nav>
      <span className="archive-tag"><i/> Архив 2024</span>
    </div></header>
    <main>
      <div className="page-heading">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="page-actions">
          <button className="button secondary" onClick={copyLink}><Link2 size={17}/> Скопировать ссылку</button>
          {tab !== "review" && <button className="button secondary" disabled={!rows.length}
            onClick={() => download(rows, decisions)}><ArrowDownToLine size={17}/> Скачать список</button>}
          <span className="share-status" role="status">{shareStatus}</span>
        </div>
      </div>
      {tab === "atlas" && <>
        <div className="filterbar">
          <div className="filter-title"><SlidersHorizontal size={20}/> <strong>Параметры отбора</strong></div>
          <Select id="region" label="Субъект РФ" value={region}
            onChange={e => updateRoute({ region: e.target.value, selectedId: null })}>
            <option value="">Все субъекты</option>
            {regions.map(name => <option key={name}>{name}</option>)}
          </Select>
          <Select id="floor" label="Минимум расходов год назад" value={floor}
            onChange={e => updateRoute({ floor: Number(e.target.value), selectedId: null })}>
            <option value="0">Без порога</option>
            {floors.filter(Boolean).map(value => <option key={value} value={value}>{amount(value)} на жителя</option>)}
          </Select>
          <button className="reset" onClick={() => updateRoute({ region: "", floor: defaultFloor, selectedId: null })}>
            <RotateCcw size={15}/> Сбросить
          </button>
        </div>
        <div className="workbench">
          <TerritoryMap data={atlas.candidates} outline={atlas.outline} rows={rows}
            selected={selected} onSelect={selectCandidate}/>
          <CandidateList rows={rows} count={count} selected={selected} decisions={decisions}
            onSelect={selectCandidate} onPilot={() => move("pilot")}/>
        </div>
        <div className="period-strip"><span><strong>Дата решения</strong> Декабрь 2024</span>
          <span><strong>Данные доступны по</strong> Октябрь 2024</span>
          <button onClick={() => move("review")}>Проверить расчёт <ArrowUpRight size={16}/></button>
        </div>
      </>}
      <div hidden={tab !== "pilot"}>
        <Pilot rows={rows} selected={selected} decision={decisions[selected?.id]} storageFailed={storageFailed}
          onDecision={record} onSelect={selectCandidate} onBack={() => move("atlas")}/>
      </div>
      {tab === "review" && <Review data={atlas} floor={reviewFloor} cohort={reviewCohort}
        objective={reviewObjective} onChange={updateRoute}/>}
      <footer><a href="https://sberindex.ru/ru/research/data-sense-opisanie-nabora-dannikh-khakatona-sberindeksa-po-munitsipalnim-dannim">СберИндекс</a> · муниципальные расходы на маркетплейсах · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
        <span>Демонстрация на исторических данных</span></footer>
    </main>
  </>;
}

createRoot(document.getElementById("root")).render(<App/>);
