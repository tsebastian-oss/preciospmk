"use client";

import { useEffect, useMemo, useState } from "react";
import baseStyles from "./VictorinoxMarketPanel.module.css";
import executiveStyles from "./VictorinoxExecutive.module.css";
import VictorinoxCopilot from "./VictorinoxCopilot";
import VictorinoxMatrix from "./VictorinoxMatrix";
import VictorinoxHistory from "./VictorinoxHistory";
import VictorinoxDownloads from "./VictorinoxDownloads";
import VictorinoxPositioning from "./VictorinoxPositioning";
import VictorinoxWhiteSpaces from "./VictorinoxWhiteSpaces";
import { trackUsageEvent } from "@/lib/usage-client";

const styles={...baseStyles,...executiveStyles};

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
  comparableBenchmarkMedian: number | null;
  comparablePriceIndex: number | null;
  comparablePremiumPct: number | null;
  comparableSample: number;
  comparableBand: { low:number|null; high:number|null };
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

type Tab = "overview" | "positioning" | "whitespace" | "copilot" | "categories" | "matrix" | "history" | "retailers" | "downloads";

const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const number = new Intl.NumberFormat("es-CL");

function clp(value:number|null|undefined){return value==null||!Number.isFinite(Number(value))?"—":money.format(Number(value));}
function date(value:string|null|undefined){return value?new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(value)):"—";}
function indexClass(value:number|null){if(value==null)return styles.indexNeutral;if(value>=120)return styles.indexHigh;if(value>=105)return styles.indexPremium;if(value<95)return styles.indexValue;return styles.indexParity;}
function signedPct(value:number|null|undefined){if(value==null||!Number.isFinite(value))return "—";return `${value>0?"+":""}${value.toFixed(1)}%`;}

function CategoryTable({ rows }:{ rows:SummaryRow[] }) {
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>Marca</th><th>SKU</th><th>Retailers</th><th>Mediana</th><th>Promedio</th><th>Rango</th><th>Promo</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.category+"-"+row.brand} className={row.brand==="Victorinox"?styles.ownRow:undefined}>
      <td><strong>{row.brand}</strong>{row.brand==="Victorinox"&&<small className={styles.ownTag}>MARCA FOCO</small>}</td><td>{number.format(row.skuCount)}</td><td>{row.retailers}</td>
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

  const executive=useMemo(()=>{
    if(!payload)return null;
    const valid=payload.position.filter(row=>row.comparablePriceIndex!=null);
    const highest=[...valid].sort((a,b)=>(b.comparablePriceIndex??0)-(a.comparablePriceIndex??0))[0]??null;
    const closest=[...valid].sort((a,b)=>Math.abs((a.comparablePriceIndex??100)-100)-Math.abs((b.comparablePriceIndex??100)-100))[0]??null;
    let bestGap:{retailer:string;category:string;own:number;leader:number;brand:string;score:number}|null=null;
    for(const retailer of payload.retailers){
      for(const cat of payload.categories){
        const scoped=payload.listings.filter(row=>row.retailer===retailer&&row.category===cat&&row.currentPrice>0&&row.inStock!==false);
        const own=new Set(scoped.filter(row=>row.brand==="Victorinox").map(row=>row.id)).size;
        const groups=new Map<string,Set<string>>();
        for(const row of scoped.filter(row=>row.brand!=="Victorinox")){
          if(!groups.has(row.brand))groups.set(row.brand,new Set());
          groups.get(row.brand)!.add(row.id);
        }
        const leader=[...groups.entries()].sort((a,b)=>b[1].size-a[1].size)[0];
        if(!leader||leader[1].size<2||leader[1].size<=own)continue;
        const score=Math.round((leader[1].size-own)/leader[1].size*100);
        if(!bestGap||score>bestGap.score)bestGap={retailer,category:cat,own,leader:leader[1].size,brand:leader[0],score};
      }
    }
    return {highest,closest,bestGap};
  },[payload]);

  if(loading)return <section className={styles.shell}><div className={styles.state}>Cargando mercado competitivo de Victorinox…</div></section>;
  if(error||!payload)return <section className={styles.shell}><div className={styles.error}>{error||"No disponible."}<button onClick={()=>void load()}>Reintentar</button></div></section>;

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span>VICTORINOX · COMMERCIAL & PRICING INTELLIGENCE</span>
        <h1>Cómo está posicionada Victorinox en Chile</h1>
        <p>Una lectura ejecutiva de <strong>pricing, competencia, distribución, surtido y promociones</strong> en relojes, equipo de viaje, navajas/multiherramientas y cuchillos.</p>
      </div>
      <div className={styles.liveBox}><span><i/> MARKET LIVE</span><strong>{payload.kpis.retailers} retailers · {payload.kpis.competitorBrands} marcas competidoras</strong><small>Última observación {date(payload.lastObservedAt)}</small></div>
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
        ["overview","Executive Overview"],["positioning","Price Positioning"],["whitespace","White Spaces"],["copilot","AI Analyst"],["categories","Categorías"],["matrix","Matriz"],["history","Histórico"],["retailers","Retailers"],["downloads","Exportar"]
      ] as [Tab,string][]).map(([key,label])=><button key={key} className={tab===key?styles.active:""} onClick={()=>{setTab(key);trackUsageEvent("tab_view",{module:"victorinox-market",metadata:{tab:key}})}}>{label}</button>)}
    </nav>

    {tab==="overview"&&<>
      <section className={styles.executiveHeader}>
        <div><span>EXECUTIVE OVERVIEW</span><h2>Posición de mercado por categoría</h2><p>Comparable Price Index usa competidores dentro del corredor central de precios Victorinox (P10–P90). El Market Index completo queda como referencia secundaria.</p></div>
        <button onClick={()=>setTab("copilot")}>Preguntar al AI Analyst →</button>
      </section>

      <section className={styles.positionGrid}>
        {payload.position.map(row=><article className={`${styles.positionCard} ${styles.executivePositionCard}`} key={row.category}>
          <span>{row.category.toUpperCase()}</span>
          <h2>{clp(row.own?.medianPrice)}</h2>
          <p>Mediana Victorinox</p>
          <div className={styles.cardBenchmark}><small>Benchmark comparable</small><strong>{clp(row.comparableBenchmarkMedian)}</strong></div>
          <div className={styles.cardMeta}><span>{row.own?.skuCount??0} SKU</span><span>{row.own?.retailers??0} retailers</span><span>{row.own?.promoPct.toFixed(1)??"0.0"}% promo</span></div>
          <em className={indexClass(row.comparablePriceIndex)}>{row.comparablePriceIndex==null?"—":row.comparablePriceIndex.toFixed(1)}</em>
          <footer>{row.comparablePremiumPct==null?"Sin comparable":`${signedPct(row.comparablePremiumPct)} comparable`} · Market Index {row.priceIndex?.toFixed(1)??"—"}</footer>
        </article>)}
      </section>

      <section className={styles.signalGrid}>
        <article><span>MAYOR PREMIUM COMPARABLE</span><strong>{executive?.highest?.category??"—"}</strong><small>{executive?.highest?.comparablePremiumPct==null?"sin comparable":`${signedPct(executive.highest.comparablePremiumPct)} vs corredor comparable`}</small></article>
        <article><span>MÁS CERCA DE PARIDAD</span><strong>{executive?.closest?.category??"—"}</strong><small>{executive?.closest?.comparablePriceIndex==null?"sin comparable":`Comparable Index ${executive.closest.comparablePriceIndex.toFixed(1)}`}</small></article>
        <article><span>WHITE SPACE #1</span><strong>{executive?.bestGap?.retailer??"—"}</strong><small>{executive?.bestGap?`${executive.bestGap.category} · ${executive.bestGap.own} vs ${executive.bestGap.leader} SKU ${executive.bestGap.brand}`:"sin brecha relevante"}</small></article>
        <article><span>PROMO VICTORINOX</span><strong>{payload.kpis.promotedOwnSkus}</strong><small>SKU promocionados observados</small></article>
      </section>

      <section className={styles.grid2}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>LECTURA EJECUTIVA</span><h2>Señales principales</h2></div></div>
          <div className={styles.insights}>{payload.insights.map((text,index)=><div key={text}><b>{String(index+1).padStart(2,"0")}</b><p>{text}</p></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>COMPETENCIA</span><h2>Benchmarks por vertical</h2></div></div>
          <div className={styles.benchmarks}>{payload.position.map(row=><div key={row.category}><strong>{row.category}</strong><span>{row.competitors.slice(0,4).map(c=>c.brand).join(" · ")||"Sin benchmark"}</span></div>)}</div>
          <button className={styles.panelAction} onClick={()=>setTab("positioning")}>Abrir arquitectura de precios →</button>
        </article>
      </section>
      <VictorinoxHistory compact/>
    </>}

    {tab==="positioning"&&<VictorinoxPositioning rows={payload.listings} categories={payload.categories}/>}
    {tab==="whitespace"&&<VictorinoxWhiteSpaces rows={payload.listings} categories={payload.categories}/>}
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
      <div className={styles.panelTitle}><div><span>RETAILER INTELLIGENCE</span><h2>Canales monitoreados</h2><p>Distribución de evidencia, surtido competitivo y presión promocional por canal.</p></div></div>
      <div className={styles.retailerGrid}>{payload.retailers.map(retailer=>{
        const rows=payload.listings.filter(row=>row.retailer===retailer);
        const own=rows.filter(row=>row.brand==="Victorinox");
        return <article key={retailer}><span>RETAILER</span><h3>{retailer}</h3><strong>{number.format(rows.length)} SKU mercado</strong><small>{new Set(rows.map(r=>r.brand)).size} marcas · {own.length} listings Victorinox · {own.filter(r=>(r.promotionPct??0)>0).length} propios en promo</small></article>;
      })}</div>
    </section>}

    {tab==="downloads"&&<VictorinoxDownloads/>}

    <footer className={styles.footer}>MGP Price Intelligence · Victorinox Chile · pricing, assortment & competitive intelligence</footer>
  </section>;
}
