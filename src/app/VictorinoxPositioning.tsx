"use client";

import { useMemo, useState } from "react";
import baseStyles from "./VictorinoxMarketPanel.module.css";
import executiveStyles from "./VictorinoxExecutive.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

const styles={...baseStyles,...executiveStyles};

type Row = {
  id: string;
  retailer: string;
  brand: string;
  category: string;
  currentPrice: number;
  regularPrice: number | null;
  promotionPct: number | null;
  inStock: boolean;
};

type BrandPosition = {
  brand: string;
  sku: number;
  retailers: number;
  entry: number;
  median: number;
  premium: number;
  promoPct: number;
  vsVictorinox: number | null;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] == null ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function pct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export default function VictorinoxPositioning({ rows, categories }:{ rows:Row[]; categories:string[] }) {
  const [category, setCategory] = useState(categories[0] ?? "");
  const [retailer, setRetailer] = useState("");

  const retailers = useMemo(() => [...new Set(rows.map(row => row.retailer))].sort((a,b)=>a.localeCompare(b,"es")), [rows]);

  const positions = useMemo<BrandPosition[]>(() => {
    const scoped = rows.filter(row => row.category === category && (!retailer || row.retailer === retailer) && row.currentPrice > 0 && row.inStock !== false);
    const groups = new Map<string, Row[]>();
    for (const row of scoped) groups.set(row.brand, [...(groups.get(row.brand) ?? []), row]);
    const ownRows = groups.get("Victorinox") ?? [];
    const ownMedian = quantile(ownRows.map(row => row.currentPrice), .5);

    return [...groups.entries()].map(([brand, items]) => {
      const prices = items.map(item => item.currentPrice).filter(value => value > 0);
      const med = quantile(prices, .5);
      return {
        brand,
        sku: new Set(items.map(item => item.id)).size,
        retailers: new Set(items.map(item => item.retailer)).size,
        entry: quantile(prices, .1),
        median: med,
        premium: quantile(prices, .9),
        promoPct: items.length ? items.filter(item => (item.promotionPct ?? 0) > 0).length / items.length * 100 : 0,
        vsVictorinox: brand === "Victorinox" || !ownMedian || !med ? null : (ownMedian / med - 1) * 100,
      };
    }).sort((a,b) => a.brand === "Victorinox" ? -1 : b.brand === "Victorinox" ? 1 : b.median - a.median);
  }, [rows, category, retailer]);

  const own = positions.find(item => item.brand === "Victorinox") ?? null;
  const competitors = positions.filter(item => item.brand !== "Victorinox");
  const marketMedian = quantile(competitors.map(item => item.median).filter(Boolean), .5);
  const marketIndex = own?.median && marketMedian ? own.median / marketMedian * 100 : null;
  const closest = competitors.length && own ? [...competitors].sort((a,b)=>Math.abs(a.median-own.median)-Math.abs(b.median-own.median))[0] : null;
  const promoLeader = positions.length ? [...positions].sort((a,b)=>b.promoPct-a.promoPct)[0] : null;

  return <section className={styles.panel}>
    <div className={styles.panelTitle}>
      <div>
        <span>PRICE POSITIONING</span>
        <h2>Arquitectura competitiva de precios</h2>
        <p>Compara bandas de entrada, core y premium usando percentiles P10 / P50 / P90 para reducir el efecto de outliers.</p>
      </div>
      <div className={styles.filterRow}>
        <label className={styles.selector}><span>Categoría</span><select value={category} onChange={e=>{setCategory(e.target.value);trackUsageEvent("filter_change",{module:"victorinox-positioning",metadata:{filter:"category",value:e.target.value}})}}>{categories.map(item=><option key={item}>{item}</option>)}</select></label>
        <label className={styles.selector}><span>Retailer</span><select value={retailer} onChange={e=>{setRetailer(e.target.value);trackUsageEvent("filter_change",{module:"victorinox-positioning",metadata:{filter:"retailer",value:e.target.value||"all"}})}}><option value="">Todos los retailers</option>{retailers.map(item=><option key={item}>{item}</option>)}</select></label>
      </div>
    </div>

    <div className={styles.signalGrid}>
      <article><span>PRICE INDEX</span><strong>{marketIndex == null ? "—" : marketIndex.toFixed(1)}</strong><small>mercado comparable = 100</small></article>
      <article><span>MEDIANA VICTORINOX</span><strong>{own ? money.format(Math.round(own.median)) : "—"}</strong><small>{category}</small></article>
      <article><span>COMPETIDOR MÁS CERCANO</span><strong>{closest?.brand ?? "—"}</strong><small>{closest ? `${pct(closest.vsVictorinox)} Victorinox vs marca` : "sin comparable"}</small></article>
      <article><span>MAYOR PRESIÓN PROMO</span><strong>{promoLeader?.brand ?? "—"}</strong><small>{promoLeader ? `${promoLeader.promoPct.toFixed(1)}% del surtido en promo` : "sin datos"}</small></article>
    </div>

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Marca</th><th>SKU</th><th>Retailers</th><th>Entrada · P10</th><th>Core · P50</th><th>Premium · P90</th><th>Promo</th><th>Premium Victorinox</th></tr></thead>
        <tbody>{positions.map(item=><tr key={item.brand} className={item.brand === "Victorinox" ? styles.ownRow : undefined}>
          <td><strong>{item.brand}</strong>{item.brand === "Victorinox" && <small className={styles.ownTag}>MARCA FOCO</small>}</td>
          <td>{item.sku}</td><td>{item.retailers}</td>
          <td>{money.format(Math.round(item.entry))}</td><td><strong>{money.format(Math.round(item.median))}</strong></td><td>{money.format(Math.round(item.premium))}</td>
          <td>{item.promoPct.toFixed(1)}%</td><td className={item.vsVictorinox != null && item.vsVictorinox > 0 ? styles.premiumCell : styles.neutralCell}>{item.brand === "Victorinox" ? "BASE" : pct(item.vsVictorinox)}</td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className={styles.methodNote}><strong>Lectura:</strong> “Premium Victorinox” muestra cuánto más alta o baja es la mediana Victorinox frente a cada marca dentro de la misma categoría y filtro de retailer.</div>
  </section>;
}
