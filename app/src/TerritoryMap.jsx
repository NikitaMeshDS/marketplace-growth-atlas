import React, { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, LocateFixed } from "lucide-react";

const width = 1000;
const height = 440;
const nationwide = { west: 11, east: 195, south: 38, north: 80 };
const longitude = lon => lon < 0 ? lon + 360 : lon;
const located = row => row.lat !== null && row.lon !== null;

function makeView(points, focus) {
  const places = points.filter(located);
  if (!focus || !places.length) return nationwide;
  return {
    west: Math.min(...places.map(row => longitude(row.lon))) - 9,
    east: Math.max(...places.map(row => longitude(row.lon))) + 9,
    south: Math.min(...places.map(row => row.lat)) - 4,
    north: Math.max(...places.map(row => row.lat)) + 4,
  };
}

function project(view, lon, lat) {
  return [
    (longitude(lon) - view.west) / (view.east - view.west) * width,
    (view.north - lat) / (view.north - view.south) * height,
  ];
}

export function TerritoryMap({ data, outline, rows, selected, onSelect }) {
  const canvas = useRef(null);
  const [focus, setFocus] = useState(false);
  const view = useMemo(() => makeView(rows, focus), [rows, focus]);
  const missing = rows.filter(row => !located(row)).length;

  useEffect(() => {
    const ctx = canvas.current.getContext("2d");
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#191f43";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#343c66";
    ctx.lineWidth = 0.75;
    const dx = view.east - view.west > 60 ? 20 : 5;
    const dy = view.north - view.south > 23 ? 10 : 5;
    ctx.beginPath();
    for (let i = Math.ceil(view.west / dx) * dx; i < view.east; i += dx) {
      const [x] = project(view, i, 0);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let i = Math.ceil(view.south / dy) * dy; i < view.north; i += dy) {
      const [, y] = project(view, 0, i);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#2d395f";
    ctx.strokeStyle = "#5b7095";
    ctx.lineWidth = 1;
    for (const polygon of outline) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([lon, lat], index) => {
          const [x, y] = project(view, lon, lat);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill("evenodd");
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(156, 190, 231, .50)";
    for (const row of data) {
      if (!located(row)) continue;
      const [x, y] = project(view, row.lon, row.lat);
      if (x < 0 || x > width || y < 0 || y > height) continue;
      ctx.fillRect(x, y, 1.8, 1.8);
    }
  }, [data, outline, view]);

  return (
    <section className="map-panel" aria-labelledby="map-title">
      <div className="map-header">
        <div><h2 id="map-title">Карта кандидатов</h2><p>Муниципалитеты в архиве</p></div>
        <button className="map-tool" onClick={() => setFocus(value => !value)}
          disabled={!rows.some(located)} aria-pressed={focus}>
          {focus ? <LocateFixed size={17} /> : <Crosshair size={17} />}
          {focus ? "Вся карта" : "Фокус"}
        </button>
      </div>
      <div className="map-viewport">
        <canvas ref={canvas} width={width * 2} height={height * 2}
          aria-label="Схематическая карта местоположения муниципалитетов" role="img" />
        {rows.map((row, index) => {
          if (!located(row)) return null;
          const [x, y] = project(view, row.lon, row.lat);
          return <button key={row.id} type="button"
            className={`map-pin ${selected?.id === row.id ? "selected" : ""}`}
            style={{ left: `${x / width * 100}%`, top: `${y / height * 100}%` }}
            aria-label={`На карте: ${row.name}`} aria-pressed={selected?.id === row.id}
            onClick={() => onSelect(row.id)}>{index + 1}</button>;
        })}
      </div>
      <div className="map-legend">
        <span><i className="legend-pin" /> Кандидат</span>
        <span><i className="legend-point" /> Территория архива</span>
        <span className="map-attribution">Контур Natural Earth</span>
      </div>
      {missing > 0 && <p className="map-missing">Координаты доступны у {rows.length - missing} из {rows.length} кандидатов.</p>}
    </section>
  );
}
