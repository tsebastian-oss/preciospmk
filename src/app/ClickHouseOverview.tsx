"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ClickHouseOverview.module.css";

type Option = { value: string; products: number };
type Retailer = {
  retailer: string;
  products: number;
  inStock: number;
  availabilityPct: number;
  averagePrice: number;
  medianPrice: number;
  promotions: number;
  promotionPct: number;
  lastObservedAt: string | null;
};
type TrendPoint = { date: string; averagePrice: number; medianPrice: number; products: number };
type Gap = {
  brand: string;
  category: string;
  retailers: number;
  products: number;
  lowRetailer: string;
  highRetailer: string;
  lowPrice: number;
  highPrice: number;
  gapPct: number;
};
type Promotion = {
  name: string;
  brand: string | null;
  category: string | null;
  retailer: string;
  regularPrice: number;
  offerPrice: number;
  discountPct: number;
  observedAt: string | null;
};
type Change = {
  name: string;
  brand: string | null;
  retailer: string;
  previousPrice: number;
  currentPrice: number;
  changePct: number;
  observedAt: string | null;
};
type DashboardPayload = {
  source: "clickhouse";
  generatedAt: string;
  filters: { retailer: string | null; category: string | null; brand: string | null; days: number };
  kpis: {
    monitoredProducts: number;
    retailers: number;
    averagePrice: number;
    medianPrice: number;
    medianVariationPct: number | null;
    inStockProducts: number;
    availabilityPct: number;
    promotions: number;
    promotionPct: number;
    priceChangesToday: number;
    lastObservedAt: string | null;
  };
  trend: TrendPoint[];
  retailers: Retailer[];
  gaps: Gap[];
  promotions: Promotion[];
  changes: Change[];
  options: { categories: Option[]; brands: Option[] };
  semantics: { headlinePrice: string; trendPrice: string; gaps: string; currentDayMayBePartial: boolean };
};

type Props = {
  onNavigate: (target: string) => void;
};

const moneyFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });

function money(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function number(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function compact(value: number) {
  return compactFormatter.format(Number.isFinite(value) ? value : 0);
}

function pct(value: number | null | undefined, sign = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${sign && normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function shortDate(value: string) {
  try {
    return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", "");
  } catch {
    return value;
  }
}

function datasetDate(value: string | null | undefined) {
  if (!value) return "fecha no disponible";
  try {
    return new Intl.DateTimeFormat("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "America/Santiago",
    }).format(new Date(value)).replace(".", "");
  } catch {
    return "fecha no disponible";
  }
}

function Sparkline({ values }: { values: number[] }) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return <div className={styles.sparkEmpty}/>;
  const width = 104;
  const height = 30;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(1, max - min);
  const path = clean.map((value, index) => {
    const x = index / Math.max(1, clean.length - 1) * width;
    const y = height - 3 - (value - min) / range * (height - 6);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><path d={path}/></svg>;
}

function KpiCard({ label, value, change, detail, values }: { label: string; value: string; change?: number | null; detail: string; values?: number[] }) {
  return <article className={styles.kpiCard}>
    <span>{label}</span>
    <div className={styles.kpiValueRow}>
      <strong>{value}</strong>
      {change !== undefined && change !== null && <b className={change >= 0 ? styles.up : styles.down}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%</b>}
    </div>
    <small>{detail}</small>
    <Sparkline values={values ?? []}/>
  </article>;
}

function LineChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <div className={styles.emptyChart}>Aún no hay suficientes días para construir la tendencia.</div>;
  const width = 760;
  const height = 260;
  const margin = { top: 18, right: 18, bottom: 34, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => point.medianPrice).filter((value) => value > 0);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max(1, (rawMax - rawMin) * .16, rawMax * .02);
  const min = Math.max(0, rawMin - pad);
  const max = rawMax + pad;
  const x = (index: number) => margin.left + index / Math.max(1, points.length - 1) * plotWidth;
  const y = (value: number) => margin.top + (max - value) / Math.max(1, max - min) * plotHeight;
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.medianPrice).toFixed(1)}`).join(" ");
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 4)) === 0);
  return <div className={styles.lineChartWrap}>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.lineChart} role="img" aria-label="Evolución del precio mediano">
      {[0, 1, 2, 3].map((index) => {
        const value = max - index * (max - min) / 3;
        const yy = y(value);
        return <g key={index}><line x1={margin.left} x2={width - margin.right} y1={yy} y2={yy}/><text x={margin.left - 10} y={yy + 4}>{money(value)}</text></g>;
      })}
      <path d={path}/>
      {points.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(point.medianPrice)} r={index === points.length - 1 ? 4 : 2.2}/>)}
      {labels.map((point) => {
        const index = points.indexOf(point);
        return <text className={styles.xLabel} key={point.date} x={x(index)} y={height - 9}>{shortDate(point.date)}</text>;
      })}
    </svg>
    <div className={styles.legend}><span><i/>Precio mediano</span><em>Base: productos observados en ClickHouse</em></div>
  </div>;
}

function RetailerBars({ rows }: { rows: Retailer[] }) {
  if (!rows.length) return <div className={styles.emptyChart}>No hay retailers para los filtros seleccionados.</div>;
  const sorted = [...rows].filter((row) => row.medianPrice > 0).sort((a, b) => b.medianPrice - a.medianPrice).slice(0, 8);
  const max = Math.max(...sorted.map((row) => row.medianPrice), 1);
  return <div className={styles.retailerBars}>{sorted.map((row, index) => <div className={styles.retailerBarItem} key={row.retailer}>
    <span>{money(row.medianPrice)}</span>
    <div className={styles.barTrack}><i className={index === Math.floor(sorted.length / 2) ? styles.highlightBar : ""} style={{ height: `${Math.max(9, row.medianPrice / max * 100)}%` }}/></div>
    <small>{row.retailer.replace("Farmacias ", "")}</small>
  </div>)}</div>;
}

function Skeleton() {
  return <div className={styles.skeleton}><div/><div/><div/><div/><div/><section/><section/><article/></div>;
}

export default function ClickHouseOverview({ onNavigate }: Props) {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [retailer, setRetailer] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false, signal?: AbortSignal) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    if (retailer) params.set("retailer", retailer);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);
    try {
      const response = await fetch(`/api/clickhouse-dashboard?${params.toString()}`, { cache: "no-store", signal });
      const data = await response.json() as DashboardPayload & { error?: string };
      if (!response.ok || data.source !== "clickhouse") throw new Error(data.error || "No fue posible cargar ClickHouse.");
      setPayload(data);
      setError("");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "No fue posible cargar el dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [retailer, category, brand, days]);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const trendValues = payload?.trend.map((point) => point.medianPrice) ?? [];
  const productValues = payload?.trend.map((point) => point.products) ?? [];
  const retailerOptions = payload?.retailers ?? [];
  const categories = payload?.options.categories ?? [];
  const brands = payload?.options.brands ?? [];
  const priceDrops = (payload?.changes ?? []).filter((item) => item.changePct < 0).slice(0, 4);
  const priceIncreases = (payload?.changes ?? []).filter((item) => item.changePct > 0).slice(0, 4);
  const maxProducts = Math.max(...(payload?.retailers ?? []).map((item) => item.products), 1);
  const datasetLabel = useMemo(() => datasetDate(payload?.kpis.lastObservedAt), [payload?.kpis.lastObservedAt]);

  return <section className={styles.dashboard}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>PRICE INTELLIGENCE</span>
        <h1>Price Intelligence Dashboard</h1>
        <p>Pricing, promociones y movimientos competitivos calculados en ClickHouse sobre un dataset demo congelado.</p>
      </div>
      <div className={styles.headerStatus}>
        <span className={styles.liveDot}/>
        <div><small>DATASET DEMO</small><strong>{datasetLabel}</strong></div>
        <button onClick={() => void load(true)} disabled={refreshing} title="Actualizar vista">{refreshing ? "…" : "↻"}</button>
        <div className={styles.clickhouseBadge}><i>▥</i><span><small>POWERED BY</small><strong>ClickHouse</strong></span></div>
      </div>
    </header>

    <section className={styles.filters}>
      <label><span>Retailer</span><select value={retailer} onChange={(event) => { setRetailer(event.target.value); setCategory(""); setBrand(""); }}><option value="">Todos los retailers</option>{retailerOptions.map((item) => <option key={item.retailer} value={item.retailer}>{item.retailer}</option>)}</select></label>
      <label><span>Categoría</span><select value={category} onChange={(event) => { setCategory(event.target.value); setBrand(""); }}><option value="">Todas las categorías</option>{category && !categories.some((item) => item.value === category) && <option value={category}>{category}</option>}{categories.map((item) => <option key={item.value} value={item.value}>{item.value} · {compact(item.products)}</option>)}</select></label>
      <label><span>Marca</span><select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{brand && !brands.some((item) => item.value === brand) && <option value={brand}>{brand}</option>}{brands.map((item) => <option key={item.value} value={item.value}>{item.value} · {compact(item.products)}</option>)}</select></label>
      <label><span>Período</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option></select></label>
      <button className={styles.clearFilters} onClick={() => { setRetailer(""); setCategory(""); setBrand(""); setDays(30); }}>⌁ Limpiar</button>
    </section>

    {error && <div className={styles.error}><span>!</span>{error}<button onClick={() => void load(false)}>Reintentar</button></div>}
    {loading && !payload ? <Skeleton/> : payload && <>
      <section className={styles.kpis}>
        <KpiCard label="Precio mediano" value={money(payload.kpis.medianPrice)} change={payload.kpis.medianVariationPct} detail={`vs. día anterior · ${compact(payload.kpis.monitoredProducts)} SKU`} values={trendValues}/>
        <KpiCard label="Cambios último día" value={number(payload.kpis.priceChangesToday)} detail={`${priceDrops.length} bajas destacadas · ${priceIncreases.length} alzas destacadas`} values={payload.changes.map((item) => Math.abs(item.changePct))}/>
        <KpiCard label="Productos monitoreados" value={compact(payload.kpis.monitoredProducts)} detail={`${number(payload.kpis.inStockProducts)} con stock`} values={productValues}/>
        <KpiCard label="Retailers activos" value={number(payload.kpis.retailers)} detail={`${pct(payload.kpis.availabilityPct, false)} disponibilidad conocida`} values={payload.retailers.map((item) => item.products)}/>
        <KpiCard label="Promociones activas" value={compact(payload.kpis.promotions)} detail={`${pct(payload.kpis.promotionPct, false)} del catálogo visible`} values={payload.retailers.map((item) => item.promotions)}/>
      </section>

      <section className={styles.primaryGrid}>
        <article className={`${styles.card} ${styles.trendCard}`}>
          <header className={styles.cardHead}><div><span>PRICE EVOLUTION</span><h2>Evolución del precio mediano</h2><p>Histórico diario sobre el alcance seleccionado.</p></div><button onClick={() => onNavigate("movements")}>Ver monitoreo →</button></header>
          <LineChart points={payload.trend}/>
        </article>
        <article className={`${styles.card} ${styles.retailerCard}`}>
          <header className={styles.cardHead}><div><span>RETAILER BENCHMARK</span><h2>Precio mediano por retailer</h2><p>Comparación descriptiva; no implica SKU equivalentes.</p></div><em>Mediana</em></header>
          <RetailerBars rows={payload.retailers}/>
        </article>
      </section>

      <section className={styles.secondaryGrid}>
        <article className={`${styles.card} ${styles.coverageCard}`}>
          <header className={styles.cardHead}><div><span>MARKET COVERAGE</span><h2>Cobertura monitoreada</h2><p>Profundidad actual por fuente.</p></div></header>
          <div className={styles.coverageHero}><strong>{number(payload.kpis.retailers)}</strong><span>retailers activos</span><b>{compact(payload.kpis.monitoredProducts)}</b><small>productos</small></div>
          <div className={styles.coverageRows}>{payload.retailers.slice(0, 7).map((item) => <div key={item.retailer}><header><span>{item.retailer}</span><b>{compact(item.products)}</b></header><i><em style={{ width: `${Math.max(4, item.products / maxProducts * 100)}%` }}/></i><small>{pct(item.availabilityPct, false)} disponibilidad · {compact(item.promotions)} promos</small></div>)}</div>
        </article>

        <article className={`${styles.card} ${styles.gapsCard}`}>
          <header className={styles.cardHead}><div><span>PRICE GAPS</span><h2>Principales brechas por marca y categoría</h2><p>Medianas entre retailers; evita mezclarlo con Price Matching SKU a SKU.</p></div><button onClick={() => onNavigate("price-image")}>Ver Price Image →</button></header>
          <div className={styles.gapTable}><div className={styles.gapHeader}><span>Marca / categoría</span><span>Menor</span><span>Mayor</span><span>Brecha</span></div>{payload.gaps.length ? payload.gaps.map((item) => <div className={styles.gapRow} key={`${item.brand}-${item.category}`}><span><strong>{item.brand}</strong><small>{item.category} · {compact(item.products)} SKU</small></span><span><b>{money(item.lowPrice)}</b><small>{item.lowRetailer}</small></span><span><b>{money(item.highPrice)}</b><small>{item.highRetailer}</small></span><em>+{item.gapPct.toFixed(1)}%</em></div>) : <div className={styles.emptyRows}>No hay brechas con al menos dos retailers para este filtro.</div>}</div>
        </article>

        <aside className={styles.rightRail}>
          <article className={styles.card}>
            <header className={styles.railHead}><div><span>PRICE MOVEMENTS</span><h3>Alertas de precio</h3></div><button onClick={() => onNavigate("alerts")}>Ver todo</button></header>
            <div className={styles.alertRows}>{payload.changes.length ? payload.changes.slice(0, 5).map((item) => <div key={`${item.retailer}-${item.name}`}><span className={item.changePct < 0 ? styles.dropIcon : styles.riseIcon}>{item.changePct < 0 ? "↓" : "↑"}</span><div><strong>{item.name}</strong><small>{item.retailer} · {money(item.currentPrice)}</small></div><b className={item.changePct < 0 ? styles.goodChange : styles.badChange}>{pct(item.changePct)}</b></div>) : <p className={styles.railEmpty}>Sin cambios diarios comparables.</p>}</div>
          </article>

          <article className={styles.card}>
            <header className={styles.railHead}><div><span>PROMOTION OPPORTUNITIES</span><h3>Promociones destacadas</h3></div><button onClick={() => onNavigate("promotions")}>Ver todo</button></header>
            <div className={styles.promoRows}>{payload.promotions.length ? payload.promotions.slice(0, 5).map((item, index) => <div key={`${item.retailer}-${item.name}`}><span className={styles.promoRank}>{index + 1}</span><div><strong>{item.name}</strong><small>{item.retailer} · {money(item.offerPrice)}</small></div><b>-{item.discountPct.toFixed(0)}%</b></div>) : <p className={styles.railEmpty}>No hay promociones visibles con este filtro.</p>}</div>
          </article>
        </aside>
      </section>

      <footer className={styles.footerNote}><span><i/>CLICKHOUSE DEMO</span><p>Los KPI, gráficos, rankings y alertas se calculan en ClickHouse sobre el dataset demo congelado. Supabase continúa capturando la data nueva por separado hasta reactivar la sincronización.</p><small>Datos hasta {datasetLabel}</small></footer>
    </>}
  </section>;
}