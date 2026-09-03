"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import filterStyles from "./DailyPricingChartFilters.module.css";
import styles from "./DailyPricingChartPortal.module.css";

type TrendPoint = {
  date: string;
  price: number | null;
  skus: number | null;
};

type TrendSeries = {
  id: string;
  label: string;
  dimension: "category" | "brand";
  kind: "group" | "smart" | "brand";
  points: TrendPoint[];
};

type TrendPayload = {
  series: TrendSeries[];
  selectedSeries: string[];
  daysRequested: number;
  availableDays: number;
  firstDate: string | null;
  lastDate: string | null;
  refreshedAt: string | null;
  latestObservationAt: string | null;
  partialDay: boolean;
  live: boolean;
  pollingSeconds: number;
  historicalDaysFrozen: boolean;
  currentDayObservations: number;
  previousDayObservations: number;
  currentDayCoveragePct: number | null;
  trimLowerPct: number;
  trimUpperPct: number;
  minimumPresencePct: number;
  maxSeries: number;
  error?: string;
};

type FilterOption = {
  id: string;
  label: string;
  kind: "group" | "smart" | "brand";
  products: number;
  retailers: number;
};

type FilterPayload = {
  defaults: string[];
  categories: FilterOption[];
  brands: FilterOption[];
  maxSeries: number;
  industrySlug: string | null;
  error?: string;
};

type FilterDimension = "category" | "brand";

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("es-CL");
const DEFAULT_SERIES = ["group:non_alcoholic", "group:grocery", "group:alcoholic"];
const STORAGE_KEY = "mgp-daily-pricing-series-v2";
const SERIES_COLORS = ["#58ddff", "#a78bfa", "#ffb45f", "#6ee7b7", "#ff7fa7", "#f7e26b", "#7dd3fc", "#c4b5fd"];

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

function dataTimestampLabel(value: string | null | undefined) {
  if (!value) return "fecha no disponible";
  try {
    return new Intl.DateTimeFormat("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Santiago",
    }).format(new Date(value)).replace(".", "");
  } catch {
    return "fecha no disponible";
  }
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

function latestPoint(points: TrendPoint[], beforeDate?: string) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (beforeDate && point.date >= beforeDate) continue;
    if (numeric(point.price) !== null) return point;
  }
  return null;
}

export default function DailyPricingChartPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [days, setDays] = useState(30);
  const [payload, setPayload] = useState<TrendPayload | null>(null);
  const [filterPayload, setFilterPayload] = useState<FilterPayload | null>(null);
  const [activeSeries, setActiveSeries] = useState<string[]>([]);
  const [filtersReady, setFiltersReady] = useState(false);
  const [filterDimension, setFilterDimension] = useState<FilterDimension | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterError, setFilterError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
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
    fetch(`/api/daily-pricing-filter-options?live=${Date.now()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as FilterPayload;
        if (!response.ok) throw new Error(data.error ?? "No fue posible cargar los filtros del gráfico");
        setFilterPayload(data);
        const validIds = new Set([...data.categories, ...data.brands].map((item) => item.id));
        let saved: string[] = [];
        try {
          const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
          if (Array.isArray(parsed)) saved = parsed.filter((item): item is string => typeof item === "string" && validIds.has(item));
        } catch {
          saved = [];
        }
        const defaults = data.defaults.filter((item) => validIds.has(item));
        setActiveSeries((saved.length ? saved : defaults.length ? defaults : DEFAULT_SERIES).slice(0, data.maxSeries || 8));
        setFilterError("");
        setFiltersReady(true);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setFilterError(reason instanceof Error ? reason.message : "No fue posible cargar los filtros");
        setActiveSeries(DEFAULT_SERIES);
        setFiltersReady(true);
      });
    return () => controller.abort();
  }, [target]);

  const seriesKey = activeSeries.join("|");

  useEffect(() => {
    if (!target || !filtersReady || !activeSeries.length) return;

    let disposed = false;
    let inFlight = false;
    let controller: AbortController | null = null;

    const loadTrend = async (initial: boolean) => {
      if (inFlight || disposed) return;
      inFlight = true;
      controller?.abort();
      controller = new AbortController();
      if (initial && !payload) setLoading(true);
      else setSyncing(true);

      try {
        const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
        activeSeries.forEach((item) => params.append("series", item));
        const response = await fetch(`/api/daily-pricing-trend?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as TrendPayload;
        if (!response.ok) throw new Error(data.error ?? "No fue posible cargar la tendencia de pricing");
        if (disposed) return;
        setPayload(data);
        setError("");
        setSyncWarning("");
        if (initial) setHoverIndex(null);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (disposed) return;
        const message = reason instanceof Error ? reason.message : "No fue posible cargar la tendencia de pricing";
        if (!payload) setError(message);
        else setSyncWarning("No fue posible actualizar la vista");
      } finally {
        inFlight = false;
        if (!disposed) {
          setLoading(false);
          setSyncing(false);
        }
      }
    };

    void loadTrend(true);

    return () => {
      disposed = true;
      controller?.abort();
    };
  }, [target, days, filtersReady, seriesKey]);

  useEffect(() => {
    if (!filtersReady || !activeSeries.length) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activeSeries));
  }, [activeSeries, filtersReady]);

  const optionMap = useMemo(() => new Map(
    [...(filterPayload?.categories ?? []), ...(filterPayload?.brands ?? [])].map((item) => [item.id, item]),
  ), [filterPayload]);

  const displaySeries = useMemo(() => (payload?.series ?? []).map((series, index) => ({
    ...series,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
  })), [payload]);

  const dates = useMemo(() => [...new Set(displaySeries.flatMap((series) => series.points.map((point) => point.date)))].sort(), [displaySeries]);
  const pointMaps = useMemo(() => new Map(displaySeries.map((series) => [series.id, new Map(series.points.map((point) => [point.date, point]))])), [displaySeries]);

  const chart = useMemo(() => {
    const width = 1000;
    const height = 330;
    const margin = { top: 24, right: 26, bottom: 44, left: 76 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = displaySeries.flatMap((series) => series.points.map((point) => numeric(point.price))).filter((value): value is number => value !== null);
    const rawMin = values.length ? Math.min(...values) : 0;
    const rawMax = values.length ? Math.max(...values) : 5000;
    const naturalSpread = Math.max(rawMax - rawMin, rawMax * 0.12, 500);
    const step = naturalSpread > 5000 ? 1000 : naturalSpread > 2000 ? 500 : 250;
    const minimum = Math.max(0, Math.floor((rawMin - naturalSpread * 0.16) / step) * step);
    const maximum = Math.max(minimum + step * 4, Math.ceil((rawMax + naturalSpread * 0.16) / step) * step);
    const x = (index: number) => margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
    const y = (value: number) => margin.top + (maximum - value) / (maximum - minimum) * plotHeight;
    const ticks = Array.from({ length: 5 }, (_, index) => maximum - index * (maximum - minimum) / 4);
    const labelEvery = Math.max(1, Math.ceil(dates.length / 6));
    const xLabels = dates.map((_, index) => index).filter((index) => index === 0 || index === dates.length - 1 || index % labelEvery === 0);
    const path = (seriesId: string) => {
      const map = pointMaps.get(seriesId);
      const points = dates.map((date, index) => {
        const price = numeric(map?.get(date)?.price);
        return price === null ? null : { x: x(index), y: y(price) };
      }).filter((point): point is { x: number; y: number } => point !== null);
      if (!points.length) return "";
      return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    };
    return { width, height, margin, plotWidth, plotHeight, minimum, maximum, x, y, ticks, xLabels, path };
  }, [dates, displaySeries, pointMaps]);

  const availableOptions = useMemo(() => {
    const options = filterDimension === "brand" ? filterPayload?.brands ?? [] : filterPayload?.categories ?? [];
    const term = filterSearch.trim().toLocaleLowerCase("es-CL");
    const filtered = term ? options.filter((item) => item.label.toLocaleLowerCase("es-CL").includes(term)) : options;
    return filtered.slice(0, 120);
  }, [filterDimension, filterPayload, filterSearch]);

  if (!target) return null;

  const activeIndex = dates.length ? Math.min(hoverIndex ?? dates.length - 1, dates.length - 1) : 0;
  const activeDate = dates[activeIndex];
  const maxSeries = filterPayload?.maxSeries ?? payload?.maxSeries ?? 8;

  function selectPoint(event: MouseEvent<SVGRectElement>) {
    if (dates.length <= 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left) / rect.width * chart.width;
    const ratio = Math.max(0, Math.min(1, (localX - chart.margin.left) / chart.plotWidth));
    setHoverIndex(Math.round(ratio * (dates.length - 1)));
  }

  function toggleSeries(id: string) {
    setActiveSeries((current) => {
      if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current;
      if (current.length >= maxSeries) return current;
      return [...current, id];
    });
    setHoverIndex(null);
  }

  function resetSeries() {
    const defaults = filterPayload?.defaults?.length ? filterPayload.defaults : DEFAULT_SERIES;
    setActiveSeries(defaults.slice(0, maxSeries));
    setFilterSearch("");
    setHoverIndex(null);
  }

  return createPortal(
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrowRow}>
            <span>DAILY PRICING TREND</span>
            <b className={styles.liveBadge}><i />LIVE DATA</b>
            <b>ACTUALIZACIÓN BAJO DEMANDA</b>
          </div>
          <h2>Evolución diaria de precios por categoría y marca</h2>
          <p>Agrega o quita líneas para comparar categorías y marcas sobre el histórico sincronizado. La vista se recalcula cuando cambias filtros o período, sin polling automático.</p>
        </div>
        <div className={styles.headerControls}>
          <div className={styles.liveMeta}>
            <i className={syncing ? styles.syncing : ""} />
            <div><strong>{syncWarning || (syncing ? "Actualizando vista" : "Actualización bajo demanda")}</strong><small>Último dato {dataTimestampLabel(payload?.latestObservationAt ?? payload?.refreshedAt)}</small></div>
          </div>
          <div className={styles.rangeControl} aria-label="Rango del gráfico">
            {[30, 60, 90].map((period) => <button key={period} className={days === period ? styles.rangeActive : ""} onClick={() => setDays(period)}>{period}D</button>)}
          </div>
        </div>
      </header>

      <section className={filterStyles.filterArea} aria-label="Filtros del gráfico">
        <div className={filterStyles.filterActions}>
          <div>
            <button type="button" className={filterDimension === "category" ? filterStyles.activeButton : ""} onClick={() => { setFilterDimension((current) => current === "category" ? null : "category"); setFilterSearch(""); }}>
              + Categorías
            </button>
            <button type="button" className={filterDimension === "brand" ? filterStyles.activeButton : ""} onClick={() => { setFilterDimension((current) => current === "brand" ? null : "brand"); setFilterSearch(""); }}>
              + Marcas
            </button>
            <button type="button" className={filterStyles.resetButton} onClick={resetSeries}>Restablecer</button>
          </div>
          <span>{activeSeries.length} de {maxSeries} líneas activas</span>
        </div>

        <div className={filterStyles.activeChips}>
          {activeSeries.map((id, index) => {
            const option = optionMap.get(id);
            const label = option?.label ?? payload?.series.find((series) => series.id === id)?.label ?? id.replace(/^[^:]+:/, "");
            return <button key={id} type="button" onClick={() => toggleSeries(id)} title={activeSeries.length === 1 ? "Debe quedar al menos una línea activa" : `Quitar ${label}`}>
              <i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
              <span>{label}</span>
              <b>×</b>
            </button>;
          })}
        </div>

        {filterDimension && <div className={filterStyles.picker}>
          <div className={filterStyles.pickerHead}>
            <div><strong>{filterDimension === "brand" ? "Agregar marcas" : "Agregar categorías"}</strong><small>Selecciona hasta {maxSeries} líneas en total.</small></div>
            <button type="button" onClick={() => setFilterDimension(null)}>×</button>
          </div>
          <input value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} placeholder={filterDimension === "brand" ? "Buscar marca…" : "Buscar categoría…"} autoFocus />
          {filterError && <div className={filterStyles.filterError}>{filterError}</div>}
          <div className={filterStyles.optionList}>
            {availableOptions.map((option) => {
              const selected = activeSeries.includes(option.id);
              const disabled = !selected && activeSeries.length >= maxSeries;
              return <button key={option.id} type="button" className={selected ? filterStyles.selectedOption : ""} disabled={disabled} onClick={() => toggleSeries(option.id)}>
                <i>{selected ? "✓" : ""}</i>
                <span><strong>{option.label}</strong><small>{option.kind === "group" ? "Grupo general · " : ""}{count.format(option.products)} SKU · {option.retailers} cadenas</small></span>
              </button>;
            })}
            {!availableOptions.length && <div className={filterStyles.noOptions}>No encontramos opciones con esa búsqueda.</div>}
          </div>
        </div>}
      </section>

      {loading && !payload ? <div className={styles.loading}><i /><span>Construyendo serie diaria…</span></div> : error && !payload ? <div className={styles.error}>{error}</div> : !displaySeries.length || !dates.length ? <div className={styles.empty}>No existen tomas suficientes para las líneas seleccionadas.</div> : <>
        <div className={styles.seriesCards}>
          {displaySeries.map((series) => {
            const latest = latestPoint(series.points);
            const previous = latest ? latestPoint(series.points, latest.date) : null;
            const change = changeLabel(numeric(latest?.price), numeric(previous?.price));
            return <div key={series.id} className={styles.seriesCard}>
              <div><i style={{ background: series.color, boxShadow: `0 0 16px ${series.color}55` }} /><span>{series.label}</span></div>
              <strong>{latest?.price === null || latest?.price === undefined ? "—" : money.format(latest.price)}</strong>
              <small className={styles[change.tone]}>{change.copy}</small>
            </div>;
          })}
        </div>

        <div className={styles.activeSnapshot}>
          <strong>{activeDate ? longDate(activeDate) : "—"}</strong>
          <div>{displaySeries.map((series) => {
            const point = activeDate ? pointMaps.get(series.id)?.get(activeDate) : null;
            const price = numeric(point?.price);
            const skus = numeric(point?.skus);
            return <span key={series.id}><i style={{ background: series.color }} />{series.label}: <b>{price === null ? "—" : money.format(price)}</b><small>{skus === null ? "" : `${count.format(skus)} SKU`}</small></span>;
          })}</div>
        </div>

        <div className={styles.chartWrap}>
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Gráfico histórico de evolución diaria de precios para las categorías y marcas seleccionadas">
            <defs>
              <filter id="pricingGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            {chart.ticks.map((tick) => <g key={tick}>
              <line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={chart.y(tick)} y2={chart.y(tick)} className={styles.gridLine} />
              <text x={chart.margin.left - 14} y={chart.y(tick) + 4} textAnchor="end" className={styles.axisLabel}>${compact.format(tick)}</text>
            </g>)}
            <line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={chart.height - chart.margin.bottom} y2={chart.height - chart.margin.bottom} className={styles.axisLine} />
            {chart.xLabels.map((index) => <text key={index} x={chart.x(index)} y={chart.height - 17} textAnchor={index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle"} className={styles.axisLabel}>{shortDate(dates[index])}</text>)}
            {displaySeries.map((series) => <path key={series.id} d={chart.path(series.id)} fill="none" stroke={series.color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter="url(#pricingGlow)" />)}
            {activeDate && <>
              <line x1={chart.x(activeIndex)} x2={chart.x(activeIndex)} y1={chart.margin.top} y2={chart.height - chart.margin.bottom} className={styles.crosshair} />
              {displaySeries.map((series) => {
                const price = numeric(pointMaps.get(series.id)?.get(activeDate)?.price);
                return price === null ? null : <g key={series.id}><circle cx={chart.x(activeIndex)} cy={chart.y(price)} r="8" fill={`${series.color}22`} /><circle cx={chart.x(activeIndex)} cy={chart.y(price)} r="4" fill={series.color} stroke="#11111c" strokeWidth="2" /></g>;
              })}
            </>}
            <rect x={chart.margin.left} y={chart.margin.top} width={chart.plotWidth} height={chart.plotHeight} fill="transparent" onMouseMove={selectPoint} onMouseLeave={() => setHoverIndex(null)} />
          </svg>
        </div>

        <footer className={styles.footer}>
          <div><span>Metodología</span><strong>Promedio recortado 5%–95%</strong><small>Cada línea usa los SKU de la categoría o marca elegida; las fechas cerradas no vuelven a modificarse.</small></div>
          <div><span>Cobertura observada</span><strong>{count.format(payload?.currentDayObservations ?? 0)} SKU en el último día disponible</strong><small>La vista consulta ClickHouse al entrar o cambiar filtros, sin polling automático.</small></div>
        </footer>
      </>}
    </article>,
    target,
  );
}