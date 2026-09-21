"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./PiwenMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";
import PiwenHistoryCharts from "./PiwenHistoryCharts";
import PiwenDownloads from "./PiwenDownloads";
import PiwenPriceMatrix, { type MatrixListing } from "./PiwenPriceMatrix";

type SummaryRow = {
  key: string;
  skuCount: number;
  brands: number;
  retailers: number;
  families: number;
  averagePricePerKg: number | null;
  medianPricePerKg: number | null;
  minPricePerKg: number | null;
  maxPricePerKg: number | null;
  promoPct: number;
};

type Listing = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  family: string;
  grams: number | null;
  format: string;
  currentPrice: number;
  regularPrice: number | null;
  pricePerKg: number | null;
  promotionPct: number | null;
  inStock: boolean;
  observedAt: string | null;
  url: string;
};

type Position = {
  family: string;
  product: string;
  format: string;
  piwenPrice: number;
  piwenPricePerKg: number | null;
  marketMedianPerKg: number | null;
  priceIndex: number | null;
  marketSkuCount: number;
  marketBrands: number;
  marketRetailers: number;
  marketBrandNames: string[];
  benchmarkQuality: "robust" | "limited" | "insufficient";
  benchmarkLabel: string;
  benchmarkNote: string;
};

type MarketplaceListing = {
  id: string;
  retailer: string;
  brand: string;
  role?: string;
  name: string;
  family: string;
  grams: number | null;
  format: string;
  currentPrice: number | null;
  regularPrice: number | null;
  pricePerKg: number | null;
  promotionPct: number | null;
  inStock: boolean | null;
  seller?: string | null;
  observedAt: string | null;
  url: string;
  verification?: string;
  sourceFreshness?: string | null;
};

type MarketplaceSnapshot = {
  status: string;
  source: string;
  domain: string;
  lastCrawledAt: string | null;
  lastStatus: string | null;
  observedAt: string | null;
  products: number;
  pricedProducts: number;
  inStockProducts: number;
  brands?: number;
  listings: MarketplaceListing[];
};

type Payload = {
  source: "supabase";
  generatedAt: string;
  lastObservedAt: string | null;
  scope: { market: string; retailers: string[]; families: string[] };
  kpis: { competitorBrands: number; marketSkus: number; retailers: number; families: number; formats: number; promotedSkus: number };
  subject: Listing[];
  piwenPosition: Position[];
  byBrand: SummaryRow[];
  byProduct: SummaryRow[];
  byFormat: SummaryRow[];
  listings: Listing[];
  insights: string[];
  note: string;
  marketplace?: MarketplaceSnapshot | null;
  official?: MarketplaceSnapshot | null;
  error?: string;
};

type Tab = "overview" | "matrix" | "downloads";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("es-CL");
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });

function clp(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : money.format(Number(value));
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function indexTone(value: number | null) {
  if (value == null) return styles.neutral;
  if (value > 105) return styles.premium;
  if (value < 95) return styles.value;
  return styles.parity;
}

function RowTable({ rows, dimension }: { rows: SummaryRow[]; dimension: "Marca" | "Producto" | "Formato" }) {
  if (!rows.length) return <div className={styles.empty}>No hay datos para este filtro.</div>;
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>{dimension}</th><th>SKU</th><th>Retailers</th><th>Mediana $/kg</th><th>Promedio $/kg</th><th>Rango $/kg</th><th>Promo</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}>
      <td><strong>{row.key}</strong>{dimension === "Marca" && <small>{row.families} familias</small>}{dimension !== "Marca" && <small>{row.brands} marcas</small>}</td>
      <td>{number.format(row.skuCount)}</td>
      <td>{number.format(row.retailers)}</td>
      <td><strong>{clp(row.medianPricePerKg)}</strong></td>
      <td>{clp(row.averagePricePerKg)}</td>
      <td>{clp(row.minPricePerKg)} – {clp(row.maxPricePerKg)}</td>
      <td>{row.promoPct.toFixed(1)}%</td>
    </tr>)}</tbody>
  </table></div>;
}

export default function PiwenMarketPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/brands/piwen/market", { cache: "no-store" });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error || "No fue posible cargar el mercado.");
      setPayload(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el mercado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    trackUsageEvent("module_view", { module: "piwen-market" });
  }, []);

  const matrixRows = useMemo<MatrixListing[]>(() => {
    if (!payload) return [];
    return [...payload.subject, ...payload.listings].map(row => ({
      id: row.id,
      retailer: row.retailer,
      brand: row.brand,
      family: row.family,
      currentPrice: row.currentPrice,
      pricePerKg: row.pricePerKg,
      inStock: row.inStock,
    }));
  }, [payload]);

  if (loading) return <section className={styles.shell}><div className={styles.state}><i/>Cargando mercado competitivo de Piwén…</div></section>;
  if (error || !payload) return <section className={styles.shell}><div className={styles.error}>{error || "Piwén no está disponible."}<button onClick={()=>void load()}>Reintentar</button></div></section>;

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>PIWÉN · MARKET PRICING INTELLIGENCE</span>
        <h1>Mercado competitivo de frutos secos</h1>
        <p>Lectura de mercado depurada por <strong>producto comparable y formato</strong>, usando precio por kilo y control de gramaje para evitar comparaciones engañosas.</p>
      </div>
      <div className={styles.liveBox}>
        <span><i/> PIWÉN + MERCADO</span>
        <strong>Última medición Piwén {date(payload.official?.lastCrawledAt ?? payload.official?.observedAt)}</strong>
        <small>Mercado competitivo {date(payload.lastObservedAt)} · próxima corrida Piwén: martes 06:35</small>
      </div>
    </header>

    <div className={styles.kpis}>
      <article><span>Marcas competidoras</span><strong>{number.format(payload.kpis.competitorBrands)}</strong><small>universo observable</small></article>
      <article><span>SKU comparables</span><strong>{compact.format(payload.kpis.marketSkus)}</strong><small>productos directos depurados</small></article>
      <article><span>Familias</span><strong>{payload.kpis.families}</strong><small>frutos secos y adyacencias</small></article>
      <article><span>Formatos</span><strong>{payload.kpis.formats}</strong><small>gramajes distintos</small></article>
      <article><span>Retailers</span><strong>{payload.kpis.retailers}</strong><small>mercado monitoreado</small></article>
      <article><span>SKU en promoción</span><strong>{number.format(payload.kpis.promotedSkus)}</strong><small>precio actual &lt; regular</small></article>
    </div>

    <nav className={styles.tabs}>
      {([
        ["overview","Resumen"],
        ["matrix","Matriz competitiva"],
        ["downloads","Descargas"],
      ] as [Tab,string][]).map(([key,label]) => <button key={key} className={tab===key?styles.active:""} onClick={()=>{setTab(key);trackUsageEvent("tab_view",{module:"piwen-market",metadata:{tab:key}})}}>{label}</button>)}
    </nav>

    {tab === "overview" && <>
      <section className={styles.grid2}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>PIWÉN VS MERCADO</span><h2>Posición de precio por kilo</h2><p>Índice 100 = mediana de productos realmente comparables por familia y gramaje. Si no hay muestra suficiente, no se calcula índice.</p></div></div>
          <div className={styles.positionList}>
            {payload.piwenPosition.map(row => <div key={row.product} className={styles.positionRow}>
              <div>
                <strong>{row.product}</strong>
                <small>{row.format} · {row.marketBrands} marcas · {row.marketSkuCount} SKU comparables{row.marketBrandNames?.length ? ` · ${row.marketBrandNames.slice(0,3).join(", ")}` : ""}</small>
                <small>{row.benchmarkQuality === "robust" ? "Benchmark robusto" : row.benchmarkQuality === "limited" ? "Muestra limitada" : "Benchmark insuficiente"} · {row.benchmarkNote}</small>
              </div>
              <div><span>Piwén</span><b>{clp(row.piwenPricePerKg)}/kg</b></div>
              <div><span>{row.benchmarkQuality === "insufficient" ? "Referencia" : "Comparable"}</span><b>{row.marketMedianPerKg == null ? "Sin muestra" : `${clp(row.marketMedianPerKg)}/kg`}</b></div>
              <em className={indexTone(row.priceIndex)}>{row.priceIndex == null ? "N/D" : `${row.priceIndex.toFixed(1)}`}</em>
            </div>)}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>LECTURA EJECUTIVA</span><h2>Señales para pricing</h2></div></div>
          <div className={styles.insights}>{payload.insights.map((text,index)=><div key={text}><span>{String(index+1).padStart(2,"0")}</span><p>{text}</p></div>)}</div>
          <div className={styles.note}>{payload.note}</div>
        </article>
      </section>

<PiwenHistoryCharts/>

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><span>TOP COMPETIDORES</span><h2>Marcas con mayor surtido observable</h2><p>Ordenadas por cantidad de SKU comparables.</p></div></div>
        <RowTable rows={payload.byBrand.slice(0,15)} dimension="Marca"/>
      </section>
    </>}

    {tab === "matrix" && <PiwenPriceMatrix rows={matrixRows}/>}


    {tab === "downloads" && <PiwenDownloads/>}

    <footer className={styles.footer}>MGP Super Precios · fuente Supabase · universo competitivo dinámico · precios normalizados por kilo · Piwén Chile</footer>
  </section>;
}
