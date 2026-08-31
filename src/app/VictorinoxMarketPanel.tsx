"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./VictorinoxMarketPanel.module.css";
import VictorinoxCopilot from "./VictorinoxCopilot";
import VictorinoxMatrix from "./VictorinoxMatrix";
import VictorinoxHistory from "./VictorinoxHistory";
import VictorinoxDownloads from "./VictorinoxDownloads";
import { trackUsageEvent } from "@/lib/usage-client";

type SummaryRow = {
  category: string;
  brand: string;
  skuCount: number;
  retailers: number;
  averagePrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  promoPct: number;
};

type Listing = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  category: string;
  currentPrice: number;
  regularPrice: number | null;
  promotionPct: number | null;
  inStock: boolean;
  observedAt: string | null;
  url: string;
};

type Position = {
  category: string;
  own: SummaryRow | null;
  benchmarkMedian: number | null;
  priceIndex: number | null;
  premiumPct: number | null;
  competitors: SummaryRow[];
};

type Payload = {
  source: "clickhouse";
  generatedAt: string;
  lastObservedAt: string | null;
  categories: string[];
  retailers: string[];
  brands: string[];
  kpis: { marketSkus: number; ownSkus: number; competitorBrands: number; retailers: number; promotedOwnSkus: number };
  position: Position[];
  summary: SummaryRow[];
  listings: Listing[];
  insights: string[];
  vertical?: any;
  error?: string;
};

type Tab = "overview" | "copilot" | "categories" | "matrix" | "history" | "retailers" | "downloads";

const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const number = new Intl.NumberFormat("es-CL");

function clp(value:number|null|undefined){return value==null||!Number.isFinite(Number(value))?"—":money.format(Number(value));}
function date(value:string|null|undefined){return value?new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(value)):"—";}
function indexClass(value:number|null){if(value==null)return styles.indexNeutral;if(value>=120)return styles.indexHigh;if(value>=105)return styles.indexPremium;if(value<95)return styles.indexValue;return styles.indexParity;}

function CategoryTable({ rows }:{ rows:SummaryRow[] }) {
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>Marca</th><th>SKU</th><th>Retailers</th><th>Mediana</th><th>Promedio</th><th>Rango</th><th>Promo</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.category+"-"+row.brand}>
      <td><strong>{row.brand}</strong></td><td>{number.format(row.skuCount)}</td><td>{row.retailers}</td>
      <td><strong>{clp(row.medianPrice)}</strong></td><td>{clp(row.averagePrice)}</td>
      <td>{clp(row.minPrice)} – {clp(row.maxPrice)}</td><td>{row.promoPct.toFixed(1)}%</td>
    </tr>)}</tbody>
  </table></div>;
}

export default function VictorinoxMarketPanel(){
  const [payload,setPayload]=useState<Payload|null>(null);
  const [tab,setTab]=useState<Tab>("overview");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [category,setCategory]=useState("");

  async function load(){
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/brands/victorinox/market",{cache:"no-store"});
      const data=await response.json() as Payload;
      if(!response.ok)throw new Error(data.error||"No fue posible cargar Victorinox.");
      setPayload(data);
    }catch(error){setError(error instanceof Error?error.message:"No fue posible cargar Victorinox.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();trackUsageEvent("module_view",{module:"victorinox-market"});},[]);

  const currentCategory=category||payload?.categories[0]||"";
  const categoryRows=useMemo(()=>payload?.summary.filter(row=>row.category===currentCategory).sort((a,b)=>a.brand==="Victorinox"?-1:b.brand==="Victorinox"?1:(a.medianPrice??Infinity)-(b.medianPrice??Infinity))??[],[payload,currentCategory]);

  if(loading)return <section className={styles.shell}><div className={styles.state}>Cargando mercado competitivo de Victorinox…</div></section>;
  if(error||!payload)return <section className={styles.shell}><div className={styles.error}>{error||"No disponible."}<button onClick={()=>void load()}>Reintentar</button></div></section>;

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span>VICTORINOX · MARKET PRICING INTELLIGENCE</span>
        <h1>Pricing competitivo por categoría</h1>
        <p>Victorinox frente a marcas comparables en <strong>relojes, equipo de viaje, navajas/multiherramientas y cuchillos</strong>, con lectura por retailer, promociones e histórico.</p>
      </div>
      <div className={styles.liveBox}><span><i/> DATA LIVE</span><strong>{payload.kpis.retailers} retailers · {payload.kpis.competitorBrands} marcas competidoras</strong><small>Última observación {date(payload.lastObservedAt)}</small></div>
    </header>

    <div className={styles.kpis}>
      <article><span>SKU Victorinox</span><strong>{number.format(payload.kpis.ownSkus)}</strong><small>mercado observado</small></article>
      <article><span>SKU mercado</span><strong>{number.format(payload.kpis.marketSkus)}</strong><small>universo comparable</small></article>
      <article><span>Competidores</span><strong>{payload.kpis.competitorBrands}</strong><small>marcas comparables</small></article>
      <article><span>Retailers</span><strong>{payload.kpis.retailers}</strong><small>canales monitoreados</small></article>
      <article><span>Promo Victorinox</span><strong>{payload.kpis.promotedOwnSkus}</strong><small>SKU con descuento</small></article>
    </div>

    <nav className={styles.tabs}>
      {([
        ["overview","Resumen"],["copilot","AI Copilot"],["categories","Por categoría"],["matrix","Matriz competitiva"],["history","Histórico"],["retailers","Retailers"],["downloads","Descargas"]
      ] as [Tab,string][]).map(([key,label])=><button key={key} className={tab===key?styles.active:""} onClick={()=>{setTab(key);trackUsageEvent("tab_view",{module:"victorinox-market",metadata:{tab:key}})}}>{label}</button>)}
    </nav>

    {tab==="overview"&&<>
      <section className={styles.positionGrid}>
        {payload.position.map(row=><article className={styles.positionCard} key={row.category}>
          <span>{row.category.toUpperCase()}</span>
          <h2>{clp(row.own?.medianPrice)}</h2>
          <p>Mediana Victorinox</p>
          <div><small>Benchmark</small><strong>{clp(row.benchmarkMedian)}</strong></div>
          <em className={indexClass(row.priceIndex)}>{row.priceIndex==null?"—":row.priceIndex.toFixed(1)}</em>
          <footer>Price Index · mercado = 100</footer>
        </article>)}
      </section>

      <section className={styles.grid2}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>LECTURA EJECUTIVA</span><h2>Señales principales</h2></div></div>
          <div className={styles.insights}>{payload.insights.map((text,index)=><div key={text}><b>{String(index+1).padStart(2,"0")}</b><p>{text}</p></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>COMPETENCIA</span><h2>Benchmarks por vertical</h2></div></div>
          <div className={styles.benchmarks}>{payload.position.map(row=><div key={row.category}><strong>{row.category}</strong><span>{row.competitors.slice(0,4).map(c=>c.brand).join(" · ")||"Sin benchmark"}</span></div>)}</div>
        </article>
      </section>
      <VictorinoxHistory compact/>
    </>}

    {tab==="copilot"&&<VictorinoxCopilot/>}

    {tab==="categories"&&<section className={styles.panel}>
      <div className={styles.panelTitle}><div><span>ANÁLISIS CATEGORIAL</span><h2>Victorinox vs competencia</h2><p>Mediana, promedio, surtido y promociones por marca.</p></div>
        <label className={styles.selector}><span>Categoría</span><select value={currentCategory} onChange={e=>setCategory(e.target.value)}>{payload.categories.map(x=><option key={x}>{x}</option>)}</select></label>
      </div>
      <CategoryTable rows={categoryRows}/>
    </section>}

    {tab==="matrix"&&<VictorinoxMatrix rows={payload.listings} categories={payload.categories}/>}

    {tab==="history"&&<VictorinoxHistory/>}

    {tab==="retailers"&&<section className={styles.panel}>
      <div className={styles.panelTitle}><div><span>CANALES</span><h2>Retailers monitoreados</h2><p>Distribución de la evidencia de mercado vigente.</p></div></div>
      <div className={styles.retailerGrid}>{payload.retailers.map(retailer=>{
        const rows=payload.listings.filter(row=>row.retailer===retailer);
        return <article key={retailer}><span>RETAILER</span><h3>{retailer}</h3><strong>{number.format(rows.length)} SKU</strong><small>{new Set(rows.map(r=>r.brand)).size} marcas · {rows.filter(r=>(r.promotionPct??0)>0).length} en promo</small></article>;
      })}</div>
    </section>}

    {tab==="downloads"&&<VictorinoxDownloads/>}

    <footer className={styles.footer}>MGP Price Intelligence · Victorinox Chile · benchmark dinámico por categoría</footer>
  </section>;
}
