"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./VictorinoxMarketPanel.module.css";

type Point = {
  date: string;
  ownMedian: number;
  benchmarkMedian: number;
  priceIndex: number;
  premiumPct: number;
  ownProducts?: number;
  competitorProducts?: number;
  competitorBrands?: number;
  benchmarkMode?: "latest_observed" | "daily";
};
type Category = { category: string; points: Point[] };
type Data = { source: "supabase"; categories: Category[]; method?: string; error?: string };

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
function d(value: string) {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(value + "T12:00:00"));
}

function Chart({ item }: { item: Category }) {
  const points = item.points;
  if (points.length < 2) {
    return <article className={styles.historyCard}><h3>{item.category}</h3><p>Sin suficientes capturas oficiales para construir la serie.</p></article>;
  }
  const values = points.flatMap((point) => [point.ownMedian, point.benchmarkMedian]);
  const min = Math.min(...values) * 0.92;
  const max = Math.max(...values) * 1.08;
  const w = 620, h = 220, l = 38, r = 16, t = 15, b = 30;
  const x = (index: number) => l + index / Math.max(1, points.length - 1) * (w - l - r);
  const y = (value: number) => t + (max - value) / Math.max(1, max - min) * (h - t - b);
  const path = (key: "ownMedian" | "benchmarkMedian") => points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point[key])}`).join(" ");
  const last = points.at(-1)!;
  return <article className={styles.historyCard}>
    <div>
      <span>EVOLUCIÓN</span>
      <h3>{item.category}</h3>
      <small>Índice {last.priceIndex.toFixed(1)} · Victorinox {money.format(last.ownMedian)} vs benchmark {money.format(last.benchmarkMedian)}</small>
    </div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Evolución de precios en ${item.category}`}>
      <path d={path("benchmarkMedian")} className={styles.historyBenchmark}/>
      <path d={path("ownMedian")} className={styles.historyOwn}/>
      <text x={l} y={h - 6}>{d(points[0].date)}</text>
      <text x={w - r} y={h - 6} textAnchor="end">{d(last.date)}</text>
    </svg>
    <div className={styles.historyLegend}><span><i className={styles.legendOwn}/>Victorinox</span><span><i className={styles.legendBenchmark}/>Benchmark observado</span></div>
  </article>;
}

export default function VictorinoxHistory({ compact = false }: { compact?: boolean }) {
  const [days, setDays] = useState(compact ? 30 : 90);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    fetch(`/api/brands/victorinox/history?days=${days}`, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "No fue posible cargar el histórico.");
        return json as Data;
      })
      .then(setData)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [days, attempt]);

  const visible = data?.categories.filter((item) => !compact || ["Relojes", "Equipo de viaje", "Navajas y multiherramientas", "Cuchillos"].includes(item.category)) ?? [];
  return <section className={styles.historySection}>
    <div className={styles.panelTitle}>
      <div>
        <span>HISTÓRICO COMPETITIVO</span>
        <h2>Evolución Victorinox vs benchmark actual</h2>
        <p>Serie diaria de Victorinox desde Supabase, comparada contra la última captura competitiva disponible como referencia constante.</p>
      </div>
      {!compact && <div className={styles.dayButtons}>{[30, 90, 180].map((value) => <button key={value} className={days === value ? styles.activeDay : ""} onClick={() => setDays(value)}>{value}D</button>)}</div>}
    </div>
    {error
      ? <div className={styles.empty}><div>{error}<button onClick={load}>Reintentar</button></div></div>
      : !data
        ? <div className={styles.empty}>Cargando capturas desde Supabase…</div>
        : visible.length
          ? <div className={styles.historyGrid}>{visible.map((item) => <Chart key={item.category} item={item}/>)}</div>
          : <div className={styles.empty}>No hay capturas suficientes para el período seleccionado.</div>}
  </section>;
}
