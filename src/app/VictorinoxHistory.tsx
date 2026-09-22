"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./VictorinoxMarketPanel.module.css";

type Point = {
  date: string;
  capturedAt?: string;
  ownMedian: number;
  benchmarkMedian: number;
  priceIndex: number;
  premiumPct: number;
  ownProducts?: number;
  competitorProducts?: number;
  competitorBrands?: number;
  officialObservedAt?: string;
  competitionObservedAt?: string;
  benchmarkMode?: "current_market";
};
type Category = { category: string; points: Point[] };
type Data = {
  source: "supabase-current-market-captures";
  categories: Category[];
  method?: string;
  error?: string;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function displayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function Chart({ item }: { item: Category }) {
  const points = item.points ?? [];
  if (!points.length) {
    return <article className={styles.historyCard}>
      <div>
        <span>SIN PUNTO VÁLIDO</span>
        <h3>{item.category}</h3>
        <small>Aún no hay una lectura actual con muestra competitiva suficiente para fijar un benchmark confiable.</small>
      </div>
    </article>;
  }

  const values = points.flatMap((point) => [Number(point.ownMedian), Number(point.benchmarkMedian)]).filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(1, rawMax - rawMin);
  const min = Math.max(0, rawMin - spread * 0.12);
  const max = rawMax + spread * 0.12;
  const w = 620, h = 220, l = 38, r = 16, t = 15, b = 30;
  const x = (index: number) => points.length === 1
    ? l + (w - l - r) / 2
    : l + index / (points.length - 1) * (w - l - r);
  const y = (value: number) => t + (max - value) / Math.max(1, max - min) * (h - t - b);
  const path = (key: "ownMedian" | "benchmarkMedian") => points
    .map((point, index) => `${index ? "L" : "M"}${x(index)},${y(Number(point[key]))}`)
    .join(" ");
  const last = points.at(-1)!;

  return <article className={styles.historyCard}>
    <div>
      <span>{points.length === 1 ? "PUNTO INICIAL" : "EVOLUCIÓN"}</span>
      <h3>{item.category}</h3>
      <small>Índice {Number(last.priceIndex).toFixed(1)} · Victorinox {money.format(Number(last.ownMedian))} vs benchmark {money.format(Number(last.benchmarkMedian))}</small>
    </div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Evolución de capturas de mercado en ${item.category}`}>
      <path d={path("benchmarkMedian")} className={styles.historyBenchmark}/>
      <path d={path("ownMedian")} className={styles.historyOwn}/>
      {points.map((point, index) => <circle key={`own-${point.date}-${index}`} cx={x(index)} cy={y(Number(point.ownMedian))} r={points.length === 1 ? 5 : 3.2} fill="#27dcff"/>)}
      {points.map((point, index) => <circle key={`bench-${point.date}-${index}`} cx={x(index)} cy={y(Number(point.benchmarkMedian))} r={points.length === 1 ? 4.5 : 2.8} fill="#6cf2be"/>)}
      {points.length === 1
        ? <text x={x(0)} y={h - 6} textAnchor="middle">{displayDate(points[0].date)}</text>
        : <>
          <text x={l} y={h - 6}>{displayDate(points[0].date)}</text>
          <text x={w - r} y={h - 6} textAnchor="end">{displayDate(last.date)}</text>
        </>}
    </svg>
    <div className={styles.historyLegend}><span><i className={styles.legendOwn}/>Victorinox</span><span><i className={styles.legendBenchmark}/>Benchmark observado</span></div>
    <small>
      {points.length} {points.length === 1 ? "captura acumulada" : "capturas acumuladas"}
      {last.ownProducts != null ? ` · última muestra ${last.ownProducts} SKU Victorinox` : ""}
      {last.competitorProducts != null ? ` vs ${last.competitorProducts} SKU` : ""}
      {last.competitorBrands != null ? ` de ${last.competitorBrands} marcas` : ""}
    </small>
  </article>;
}

export default function VictorinoxHistory() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    fetch(`/api/brands/victorinox/history?days=${days}`, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "No fue posible cargar las capturas de mercado.");
        return json as Data;
      })
      .then(setData)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [days, attempt]);

  const visible = data?.categories ?? [];
  return <section className={styles.historySection}>
    <div className={styles.panelTitle}>
      <div>
        <span>HISTÓRICO DE MERCADO</span>
        <h2>Evolución desde la lectura actual</h2>
        <p>La serie parte en la captura vigente y suma un nuevo punto cuando el monitor incorpora una lectura nueva del mercado. No reconstruye períodos anteriores con benchmarks actuales.</p>
      </div>
      <div className={styles.dayButtons}>{[7, 30, 90].map((value) => <button key={value} className={days === value ? styles.activeDay : ""} onClick={() => setDays(value)}>{value}D</button>)}</div>
    </div>
    {error
      ? <div className={styles.empty}><div>{error}<button onClick={load}>Reintentar</button></div></div>
      : !data
        ? <div className={styles.empty}>Cargando capturas de mercado desde Supabase…</div>
        : visible.length
          ? <div className={styles.historyGrid}>{visible.map((item) => <Chart key={item.category} item={item}/>)}</div>
          : <div className={styles.empty}>Todavía no hay capturas de mercado para este período.</div>}
  </section>;
}
