"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./DailyPricingChartPortal.module.css";

type TrendRow = {
  date: string;
  nonAlcoholic: number | null;
  grocery: number | null;
  alcoholic: number | null;
  nonAlcoholicSkus: number | null;
  grocerySkus: number | null;
  alcoholicSkus: number | null;
};

type TrendPayload = {
  data: TrendRow[];
  daysRequested: number;
  availableDays: number;
  firstDate: string | null;
  lastDate: string | null;
  refreshedAt: string | null;
  partialDay: boolean;
  trimLowerPct: number;
  trimUpperPct: number;
  minimumPresencePct: number;
  error?: string;
};

type PriceKey = "nonAlcoholic" | "grocery" | "alcoholic";
type SkuKey = "nonAlcoholicSkus" | "grocerySkus" | "alcoholicSkus";

type SeriesDefinition = {
  key: PriceKey;
  skuKey: SkuKey;
  label: string;
  shortLabel: string;
  color: string;
};

const SERIES: SeriesDefinition[] = [
  { key: "nonAlcoholic", skuKey: "nonAlcoholicSkus", label: "Bebidas no alcohólicas", shortLabel: "No alcohólicas", color: "#58ddff" },
  { key: "grocery", skuKey: "grocerySkus", label: "Abarrotes", shortLabel: "Abarrotes", color: "#a78bfa" },
  { key: "alcoholic", skuKey: "alcoholicSkus", label: "Bebidas alcohólicas", shortLabel: "Alcohólicas", color: "#ffb45f" },
];

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("es-CL");

function numeric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" })
    .format(new Date(`${value}T12:00:00`))
    .replace(".", "");
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "long" })
    .format(new Date(`${value}T12:00:00`));
}

function changeLabel(current: number | null, previous: number | null) {
  if (!current || !previous) return { copy: "Sin comparación", tone: "neutral" };
  const delta = (current / previous - 1) * 100;
  if (Math.abs(delta) < 0.005) return { copy: "0,0% vs. día anterior", tone: "neutral" };
  return {
    copy: `${delta > 0 ? "+" : ""}${delta.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% vs. día anterior`,
    tone: delta > 0 ? "up" : "down",
  };
}

function previousValue(rows: TrendRow[], index: number, key: PriceKey) {
  for (let position = index - 1; position >= 0; position -= 1) {
    const value = numeric(rows[position]?.[key]);
    if (value !== null) return value;
  }
  return null;
}

export default function DailyPricingChartPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [days, setDays] = useState(30);
  const [payload, setPayload] = useState<TrendPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const locate = () => {
      const next = document.querySelector<HTMLElement>("main > section.dual-grid");
      setTarget((current) => current === next ? current : next);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", locate);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", locate);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    target.classList.add(styles.replaced);
    return () => target.classList.remove(styles.replaced);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/daily-pricing-trend?days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as TrendPayload;
        if (!response.ok) throw new Error(data.error ?? "No fue posible cargar la tendencia de pricing");
        setPayload(data);
        setHoverIndex(null);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "No fue posible cargar la tendencia de pricing");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [target, days]);

  const rows = payload?.data ?? [];
  const chart = useMemo(() => {
    const width = 1000;
    const height = 330;
    const margin = { top: 24, right: 26, bottom: 44, left: 76 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = rows.flatMap((row) => SERIES.map((series) => numeric(row[series.key]))).filter((value): value is number => value !== null);
    const rawMin = values.length ? Math.min(...values) : 0;
    const rawMax = values.length ? Math.max(...values) : 5000;
    const naturalSpread = Math.max(rawMax - rawMin, rawMax * 0.12, 500);
    const step = naturalSpread > 5000 ? 1000 : naturalSpread > 2000 ? 500 : 250;
    const minimum = Math.max(0, Math.floor((rawMin - naturalSpread * 0.16) / step) * step);
    const maximum = Math.max(minimum + step * 4, Math.ceil((rawMax + naturalSpread * 0.16) / step) * step);
    const x = (index: number) => margin.left + (rows.length <= 1 ? plotWidth / 2 : index / (rows.length - 1) * plotWidth);
    const y = (value: number) => margin.top + (maximum - value) / (maximum - minimum) * plotHeight;
    const ticks = Array.from({ length: 5 }, (_, index) => maximum - index * (maximum - minimum) / 4);
    const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
    const xLabels = rows.map((_, index) => index).filter((index) => index === 0 || index === rows.length - 1 || index % labelEvery === 0);
    const path = (key: PriceKey) => {
      const points = rows.map((row, index) => {
        const value = numeric(row[key]);
        return value === null ? null : { x: x(index), y: y(value) };
      }).filter((point): point is { x: number; y: number } => point !== null);
      if (!points.length) return "";
      return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    };
    return { width, height, margin, plotWidth, plotHeight, minimum, maximum, x, y, ticks, xLabels, path };
  }, [rows]);

  if (!target) return null;

  const activeIndex = rows.length ? Math.min(hoverIndex ?? rows.length - 1, rows.length - 1) : 0;
  const activeRow = rows[activeIndex];

  function selectPoint(event: MouseEvent<SVGRectElement>) {
    if (rows.length <= 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left) / rect.width * chart.width;
    const ratio = Math.max(0, Math.min(1, (localX - chart.margin.left) / chart.plotWidth));
    setHoverIndex(Math.round(ratio * (rows.length - 1)));
  }

  return createPortal(
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrowRow}>
            <span>DAILY PRICING TREND</span>
            {payload?.partialDay && <b>HOY EN CURSO</b>}
          </div>
          <h2>Evolución diaria de precios por categoría</h2>
          <p>Precio promedio robusto de una canasta estable de SKU, consolidado entre las cadenas monitoreadas.</p>
        </div>
        <div className={styles.rangeControl} aria-label="Rango del gráfico">
          {[30, 60, 90].map((period) => <button key={period} className={days === period ? styles.rangeActive : ""} onClick={() => setDays(period)}>{period}D</button>)}
        </div>
      </header>

      {loading && !payload ? <div className={styles.loading}><i /><span>Construyendo serie diaria…</span></div> : error ? <div className={styles.error}>{error}</div> : !rows.length ? <div className={styles.empty}>Todavía no existen tomas suficientes para construir la serie diaria.</div> : <>
        <div className={styles.seriesCards}>
          {SERIES.map((series) => {
            const latest = numeric(rows.at(-1)?.[series.key]);
            const previous = previousValue(rows, rows.length - 1, series.key);
            const change = changeLabel(latest, previous);
            return <div key={series.key} className={styles.seriesCard}>
              <div><i style={{ background: series.color, boxShadow: `0 0 16px ${series.color}55` }} /><span>{series.label}</span></div>
              <strong>{latest === null ? "—" : money.format(latest)}</strong>
              <small className={styles[change.tone]}>{change.copy}</small>
            </div>;
          })}
        </div>

        <div className={styles.activeSnapshot}>
          <strong>{activeRow ? longDate(activeRow.date) : "—"}</strong>
          <div>{SERIES.map((series) => {
            const price = numeric(activeRow?.[series.key]);
            const skus = numeric(activeRow?.[series.skuKey]);
            return <span key={series.key}><i style={{ background: series.color }} />{series.shortLabel}: <b>{price === null ? "—" : money.format(price)}</b><small>{skus === null ? "" : `${count.format(skus)} SKU`}</small></span>;
          })}</div>
        </div>

        <div className={styles.chartWrap}>
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Gráfico de evolución diaria de precios promedio para bebidas no alcohólicas, abarrotes y bebidas alcohólicas">
            <defs>
              <filter id="pricingGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            {chart.ticks.map((tick) => <g key={tick}>
              <line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={chart.y(tick)} y2={chart.y(tick)} className={styles.gridLine} />
              <text x={chart.margin.left - 14} y={chart.y(tick) + 4} textAnchor="end" className={styles.axisLabel}>${compact.format(tick)}</text>
            </g>)}
            <line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={chart.height - chart.margin.bottom} y2={chart.height - chart.margin.bottom} className={styles.axisLine} />
            {chart.xLabels.map((index) => <text key={index} x={chart.x(index)} y={chart.height - 17} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"} className={styles.axisLabel}>{shortDate(rows[index].date)}</text>)}
            {SERIES.map((series) => <path key={series.key} d={chart.path(series.key)} fill="none" stroke={series.color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter="url(#pricingGlow)" />)}
            {activeRow && <>
              <line x1={chart.x(activeIndex)} x2={chart.x(activeIndex)} y1={chart.margin.top} y2={chart.height - chart.margin.bottom} className={styles.crosshair} />
              {SERIES.map((series) => {
                const value = numeric(activeRow[series.key]);
                return value === null ? null : <g key={series.key}><circle cx={chart.x(activeIndex)} cy={chart.y(value)} r="8" fill={`${series.color}22`} /><circle cx={chart.x(activeIndex)} cy={chart.y(value)} r="4" fill={series.color} stroke="#11111c" strokeWidth="2" /></g>;
              })}
            </>}
            <rect x={chart.margin.left} y={chart.margin.top} width={chart.plotWidth} height={chart.plotHeight} fill="transparent" onMouseMove={selectPoint} onMouseLeave={() => setHoverIndex(null)} />
          </svg>
        </div>

        <footer className={styles.footer}>
          <div><span>Metodología</span><strong>Promedio recortado 5%–95%</strong><small>Solo SKU presentes en al menos {payload?.minimumPresencePct ?? 60}% de las tomas del período.</small></div>
          <div><span>Histórico disponible</span><strong>{payload?.availableDays ?? rows.length} días</strong><small>{(payload?.availableDays ?? 0) < 7 ? "La serie ganará profundidad con cada nueva captura diaria." : `Ventana solicitada: ${days} días.`}</small></div>
        </footer>
      </>}
    </article>,
    target,
  );
}
