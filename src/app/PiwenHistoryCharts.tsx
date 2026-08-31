"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./PiwenHistoryCharts.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

type Brand = "Piwén" | "Alto La Cruz" | "Millantú";
type Family = "Almendras" | "Castañas de cajú" | "Pistachos";
type Point = {
  date: string;
  brand: Brand;
  family: Family;
  pricePerKg: number;
  skuCount: number;
  retailers: number;
  source: "public_reference" | "market_census";
};
type Payload = {
  from: string | null;
  to: string | null;
  brands: Brand[];
  families: Family[];
  points: Point[];
  methodology: string;
  piwenBasis: Record<string, string>;
  error?: string;
};

const BRAND_COLORS: Record<Brand, string> = {
  "Piwén": "#b9ef45",
  "Alto La Cruz": "#6fb6ff",
  "Millantú": "#ffb45f",
};

const BRAND_ORDER: Brand[] = ["Piwén", "Alto La Cruz", "Millantú"];

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(value + "T12:00:00"));
}

function compactMoney(value: number) {
  if (value >= 1000) return "$" + (value / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + "k";
  return money.format(value);
}

function HistoryChart({ family, points }: { family: Family; points: Point[] }) {
  const familyPoints = points.filter((point) => point.family === family);
  const dates = [...new Set(familyPoints.map((point) => point.date))].sort();
  const values = familyPoints.map((point) => point.pricePerKg).filter((value) => Number.isFinite(value) && value > 0);

  const width = 640;
  const height = 270;
  const left = 56;
  const right = 18;
  const top = 18;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  if (!dates.length || !values.length) {
    return <article className={styles.chartCard}>
      <div className={styles.chartHead}><div><span>EVOLUCIÓN $/KG</span><h3>{family}</h3></div></div>
      <div className={styles.empty}>Todavía no hay observaciones suficientes.</div>
    </article>;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, rawMax * 0.12, 2500);
  const min = Math.max(0, rawMin - spread * 0.15);
  const max = rawMax + spread * 0.15;

  const x = (date: string) => {
    const index = dates.indexOf(date);
    return dates.length <= 1 ? left + plotWidth / 2 : left + index / (dates.length - 1) * plotWidth;
  };
  const y = (value: number) => top + (max - value) / Math.max(1, max - min) * plotHeight;
  const yTicks = Array.from({ length: 4 }, (_, index) => max - (max - min) * index / 3);
  const xIndexes = dates.length <= 4 ? dates.map((_, index) => index) : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];

  return <article className={styles.chartCard}>
    <div className={styles.chartHead}>
      <div><span>EVOLUCIÓN $/KG</span><h3>{family}</h3></div>
      <small>{shortDate(dates[0])} – {shortDate(dates[dates.length - 1])}</small>
    </div>

    <div className={styles.legend}>
      {BRAND_ORDER.map((brand) => {
        const brandPoints = familyPoints.filter((point) => point.brand === brand);
        const last = [...brandPoints].sort((a,b)=>b.date.localeCompare(a.date))[0];
        return <div key={brand} className={!brandPoints.length ? styles.legendMissing : ""}>
          <i style={{ background: BRAND_COLORS[brand] }}/>
          <span>{brand}</span>
          <b>{last ? compactMoney(last.pricePerKg) : "sin dato"}</b>
        </div>;
      })}
    </div>

    <div className={styles.svgWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img" aria-label={`Evolución de precio por kilo de ${family}`}>
        {yTicks.map((tick) => <g key={tick}>
          <line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} className={styles.gridLine}/>
          <text x={left-8} y={y(tick)+3} textAnchor="end" className={styles.axisText}>{compactMoney(tick)}</text>
        </g>)}

        {xIndexes.map((index) => <text
          key={dates[index]}
          x={x(dates[index])}
          y={height-12}
          textAnchor={index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle"}
          className={styles.axisText}
        >{shortDate(dates[index])}</text>)}

        {BRAND_ORDER.map((brand) => {
          const series = familyPoints.filter((point) => point.brand === brand).sort((a,b)=>a.date.localeCompare(b.date));
          if (!series.length) return null;
          const path = series.map((point,index) => `${index === 0 ? "M" : "L"} ${x(point.date)} ${y(point.pricePerKg)}`).join(" ");
          return <g key={brand}>
            {series.length > 1 && <path d={path} fill="none" stroke={BRAND_COLORS[brand]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>}
            {series.map((point) => <circle
              key={brand+"-"+point.date}
              cx={x(point.date)}
              cy={y(point.pricePerKg)}
              r={4}
              fill={BRAND_COLORS[brand]}
              stroke="#0b130f"
              strokeWidth="2"
            >
              <title>{brand} · {shortDate(point.date)} · {money.format(point.pricePerKg)}/kg · {point.skuCount} SKU</title>
            </circle>)}
          </g>;
        })}
      </svg>
    </div>
  </article>;
}

export default function PiwenHistoryCharts() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/brands/piwen/history", { cache: "no-store" });
        const data = await response.json() as Payload;
        if (!response.ok) throw new Error(data.error || "No fue posible cargar el histórico.");
        if (active) setPayload(data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar el histórico.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    trackUsageEvent("module_view", { module: "piwen-price-history" });
    return () => { active = false; };
  }, []);

  const observedBrands = useMemo(() => {
    if (!payload) return [];
    return payload.brands.filter((brand) => payload.points.some((point) => point.brand === brand));
  }, [payload]);

  if (loading) return <section className={styles.section}><div className={styles.sectionHead}><div><span>HISTÓRICO COMPETITIVO</span><h2>Evolución de precios por kilo</h2></div></div><div className={styles.loading}>Construyendo series históricas…</div></section>;
  if (error || !payload) return <section className={styles.section}><div className={styles.error}>{error || "Histórico no disponible."}</div></section>;

  return <section className={styles.section}>
    <div className={styles.sectionHead}>
      <div>
        <span>HISTÓRICO COMPETITIVO</span>
        <h2>Piwén vs Alto La Cruz vs Millantú</h2>
        <p>Almendras, castañas de cajú y pistachos normalizados a precio por kilo.</p>
      </div>
      <div className={styles.period}>
        <span>VENTANA</span>
        <strong>{payload.from ? shortDate(payload.from) : "—"} – {payload.to ? shortDate(payload.to) : "—"}</strong>
        <small>{observedBrands.length} marcas con observaciones</small>
      </div>
    </div>

    <div className={styles.chartGrid}>
      {payload.families.map((family) => <HistoryChart key={family} family={family} points={payload.points}/>)}
    </div>

    <div className={styles.method}>
      <strong>Cómo leerlo:</strong> {payload.methodology}
      <span>Alto La Cruz no muestra línea en categorías donde no existen observaciones comparables en el histórico censado.</span>
    </div>
  </section>;
}
