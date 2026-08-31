"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./PiwenMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

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
};

type Payload = {
  source: "clickhouse";
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
  error?: string;
};

type Tab = "overview" | "brands" | "products" | "formats" | "detail";

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
  const [family, setFamily] = useState("");
  const [brand, setBrand] = useState("");
  const [retailer, setRetailer] = useState("");
  const [query, setQuery] = useState("");

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

  const brandOptions = useMemo(() => [...new Set((payload?.listings ?? []).map(row => row.brand))].sort((a,b)=>a.localeCompare(b,"es")), [payload]);
  const visibleListings = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es-CL");
    return (payload?.listings ?? []).filter(row => {
      if (family && row.family !== family) return false;
      if (brand && row.brand !== brand) return false;
      if (retailer && row.retailer !== retailer) return false;
      if (q && !`${row.name} ${row.brand} ${row.family} ${row.format} ${row.retailer}`.toLocaleLowerCase("es-CL").includes(q)) return false;
      return true;
    });
  }, [payload, family, brand, retailer, query]);

  const visibleBrandRows = useMemo(() => {
    if (!family && !retailer) return payload?.byBrand ?? [];
    const rows = visibleListings;
    const groups = new Map<string, Listing[]>();
    rows.forEach(row => groups.set(row.brand, [...(groups.get(row.brand) ?? []), row]));
    return [...groups.entries()].map(([key, items]) => {
      const prices = items.map(x=>x.pricePerKg).filter((x): x is number => x != null);
      const sorted = [...prices].sort((a,b)=>a-b);
      const median = sorted.length ? sorted[Math.floor(sorted.length/2)] : null;
      return {
        key,
        skuCount: items.length,
        brands: 1,
        retailers: new Set(items.map(x=>x.retailer)).size,
        families: new Set(items.map(x=>x.family)).size,
        averagePricePerKg: prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : null,
        medianPricePerKg: median,
        minPricePerKg: prices.length ? Math.min(...prices) : null,
        maxPricePerKg: prices.length ? Math.max(...prices) : null,
        promoPct: items.length ? items.filter(x=>(x.promotionPct??0)>0).length/items.length*100 : 0,
      };
    }).sort((a,b)=>b.skuCount-a.skuCount);
  }, [payload, visibleListings, family, retailer]);

  if (loading) return <section className={styles.shell}><div className={styles.state}><i/>Cargando mercado competitivo de Piwén…</div></section>;
  if (error || !payload) return <section className={styles.shell}><div className={styles.error}>{error || "Piwén no está disponible."}<button onClick={()=>void load()}>Reintentar</button></div></section>;

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>PIWÉN · MARKET PRICING INTELLIGENCE</span>
        <h1>Mercado competitivo de frutos secos</h1>
        <p>Lectura de mercado normalizada por <strong>marca, producto y formato</strong>, usando precio por kilo para comparar packs distintos.</p>
      </div>
      <div className={styles.liveBox}>
        <span><i/> CLICKHOUSE LIVE</span>
        <strong>{payload.scope.retailers.join(" · ")}</strong>
        <small>Última observación {date(payload.lastObservedAt)}</small>
      </div>
    </header>

    <div className={styles.kpis}>
      <article><span>Marcas competidoras</span><strong>{number.format(payload.kpis.competitorBrands)}</strong><small>universo observable</small></article>
      <article><span>SKU comparables</span><strong>{compact.format(payload.kpis.marketSkus)}</strong><small>con formato normalizado</small></article>
      <article><span>Familias</span><strong>{payload.kpis.families}</strong><small>frutos secos y adyacencias</small></article>
      <article><span>Formatos</span><strong>{payload.kpis.formats}</strong><small>gramajes distintos</small></article>
      <article><span>Retailers</span><strong>{payload.kpis.retailers}</strong><small>mercado monitoreado</small></article>
      <article><span>SKU en promoción</span><strong>{number.format(payload.kpis.promotedSkus)}</strong><small>precio actual &lt; regular</small></article>
    </div>

    <nav className={styles.tabs}>
      {([
        ["overview","Resumen"],
        ["brands","Por marca"],
        ["products","Por producto"],
        ["formats","Por formato"],
        ["detail","Detalle SKU"],
      ] as [Tab,string][]).map(([key,label]) => <button key={key} className={tab===key?styles.active:""} onClick={()=>{setTab(key);trackUsageEvent("tab_view",{module:"piwen-market",metadata:{tab:key}})}}>{label}</button>)}
    </nav>

    {tab === "overview" && <>
      <section className={styles.grid2}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>PIWÉN VS MERCADO</span><h2>Posición de precio por kilo</h2><p>Índice 100 = mediana vigente de mercado.</p></div></div>
          <div className={styles.positionList}>
            {payload.piwenPosition.map(row => <div key={row.product} className={styles.positionRow}>
              <div><strong>{row.product}</strong><small>{row.format} · {row.marketBrands} marcas · {row.marketSkuCount} SKU mercado</small></div>
              <div><span>Piwén</span><b>{clp(row.piwenPricePerKg)}/kg</b></div>
              <div><span>Mercado</span><b>{clp(row.marketMedianPerKg)}/kg</b></div>
              <em className={indexTone(row.priceIndex)}>{row.priceIndex == null ? "—" : `${row.priceIndex.toFixed(1)}`}</em>
            </div>)}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>LECTURA EJECUTIVA</span><h2>Señales para pricing</h2></div></div>
          <div className={styles.insights}>{payload.insights.map((text,index)=><div key={text}><span>{String(index+1).padStart(2,"0")}</span><p>{text}</p></div>)}</div>
          <div className={styles.note}>{payload.note}</div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><span>TOP COMPETIDORES</span><h2>Marcas con mayor surtido observable</h2><p>Ordenadas por cantidad de SKU comparables.</p></div></div>
        <RowTable rows={payload.byBrand.slice(0,15)} dimension="Marca"/>
      </section>
    </>}

    {tab !== "overview" && <section className={styles.filters}>
      <label><span>Familia</span><select value={family} onChange={e=>setFamily(e.target.value)}><option value="">Todas</option>{payload.scope.families.map(x=><option key={x}>{x}</option>)}</select></label>
      {(tab === "brands" || tab === "detail") && <label><span>Marca</span><select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">Todas</option>{brandOptions.map(x=><option key={x}>{x}</option>)}</select></label>}
      {tab === "detail" && <label><span>Retailer</span><select value={retailer} onChange={e=>setRetailer(e.target.value)}><option value="">Todos</option>{payload.scope.retailers.map(x=><option key={x}>{x}</option>)}</select></label>}
      {tab === "detail" && <label className={styles.search}><span>Buscar</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Producto, marca, formato…"/></label>}
      <button onClick={()=>{setFamily("");setBrand("");setRetailer("");setQuery("")}}>Limpiar</button>
    </section>}

    {tab === "brands" && <section className={styles.panel}><div className={styles.panelTitle}><div><span>MARCA</span><h2>Competencia resumida por marca</h2><p>Surtido, cobertura, promoción y nivel de precio por kilo.</p></div></div><RowTable rows={visibleBrandRows} dimension="Marca"/></section>}
    {tab === "products" && <section className={styles.panel}><div className={styles.panelTitle}><div><span>PRODUCTO</span><h2>Mercado resumido por familia</h2><p>Almendras, castañas de cajú, pistachos, nueces, maní, mixes y categorías adyacentes.</p></div></div><RowTable rows={(payload.byProduct??[]).filter(x=>!family||x.key===family)} dimension="Producto"/></section>}
    {tab === "formats" && <section className={styles.panel}><div className={styles.panelTitle}><div><span>FORMATO</span><h2>Arquitectura de packs</h2><p>Permite comparar cómo cambia el $/kg entre gramajes y detectar escalones de precio incoherentes.</p></div></div><RowTable rows={(payload.byFormat??[]).filter(x=>!family||x.key.startsWith(family+" · "))} dimension="Formato"/></section>}

    {tab === "detail" && <section className={styles.panel}>
      <div className={styles.panelTitle}><div><span>EVIDENCIA</span><h2>Detalle competitivo por SKU</h2><p>{visibleListings.length} productos visibles con precio normalizado.</p></div></div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Producto</th><th>Marca</th><th>Retailer</th><th>Formato</th><th>Precio</th><th>$/kg</th><th>Promo</th><th>Observado</th></tr></thead>
        <tbody>{visibleListings.slice(0,300).map(row=><tr key={row.id}>
          <td><a href={row.url} target="_blank" rel="noreferrer"><strong>{row.name}</strong></a><small>{row.family}</small></td>
          <td>{row.brand}</td><td>{row.retailer}</td><td>{row.format}</td>
          <td><strong>{clp(row.currentPrice)}</strong>{row.regularPrice && row.regularPrice>row.currentPrice ? <small>Ref. {clp(row.regularPrice)}</small>:null}</td>
          <td><strong>{clp(row.pricePerKg)}</strong></td>
          <td>{row.promotionPct ? `-${row.promotionPct.toFixed(1)}%` : "—"}</td>
          <td>{date(row.observedAt)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <footer className={styles.footer}>MGP Super Precios · universo competitivo dinámico · precios normalizados por kilo · Piwén Chile</footer>
  </section>;
}
