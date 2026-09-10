"use client";

import { useMemo, useState } from "react";
import styles from "./VictorinoxMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

type Row = {
  id: string;
  retailer: string;
  brand: string;
  category: string;
  currentPrice: number;
  promotionPct: number | null;
  inStock: boolean;
};

type Opportunity = {
  retailer: string;
  category: string;
  ownSkus: number;
  leaderBrand: string;
  leaderSkus: number;
  gap: number;
  score: number;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function quantile(values:number[],q:number){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),pos=(sorted.length-1)*q,base=Math.floor(pos),rest=pos-base;
  return sorted[base+1]==null?sorted[base]:sorted[base]+rest*(sorted[base+1]-sorted[base]);
}

export default function VictorinoxWhiteSpaces({ rows, categories }:{ rows:Row[]; categories:string[] }) {
  const [category,setCategory]=useState("");
  const [retailer,setRetailer]=useState("");
  const retailers=useMemo(()=>[...new Set(rows.map(row=>row.retailer))].sort((a,b)=>a.localeCompare(b,"es")),[rows]);

  const opportunities=useMemo<Opportunity[]>(()=>{
    const output:Opportunity[]=[];
    for(const r of retailers){
      if(retailer&&r!==retailer)continue;
      for(const c of categories){
        if(category&&c!==category)continue;
        const scoped=rows.filter(row=>row.retailer===r&&row.category===c&&row.currentPrice>0&&row.inStock!==false);
        if(!scoped.length)continue;
        const ownSkus=new Set(scoped.filter(row=>row.brand==="Victorinox").map(row=>row.id)).size;
        const byBrand=new Map<string,Set<string>>();
        for(const row of scoped.filter(row=>row.brand!=="Victorinox")){
          if(!byBrand.has(row.brand))byBrand.set(row.brand,new Set());
          byBrand.get(row.brand)!.add(row.id);
        }
        const leader=[...byBrand.entries()].sort((a,b)=>b[1].size-a[1].size)[0];
        if(!leader||leader[1].size<2)continue;
        const leaderSkus=leader[1].size;
        const gap=Math.max(0,leaderSkus-ownSkus);
        const score=gap<=0?0:Math.min(100,Math.round((gap/leaderSkus)*100));
        if(gap>0)output.push({retailer:r,category:c,ownSkus,leaderBrand:leader[0],leaderSkus,gap,score});
      }
    }
    return output.sort((a,b)=>b.score-a.score||b.gap-a.gap).slice(0,18);
  },[rows,categories,retailers,category,retailer]);

  const priceBandGaps=useMemo(()=>{
    const output:{label:string;market:number;own:number;from:number;to:number|null;share:number}[]=[];
    const scoped=rows.filter(row=>(!category||row.category===category)&&(!retailer||row.retailer===retailer)&&row.currentPrice>0&&row.inStock!==false);
    const competitorPrices=scoped.filter(row=>row.brand!=="Victorinox").map(row=>row.currentPrice);
    if(competitorPrices.length<6)return output;
    const q33=quantile(competitorPrices,.33),q66=quantile(competitorPrices,.66);
    const bands=[
      {label:"Entry",from:0,to:q33},
      {label:"Core",from:q33,to:q66},
      {label:"Premium",from:q66,to:null as number|null},
    ];
    for(const band of bands){
      const inBand=(price:number)=>price>=band.from&&(band.to==null||price<band.to);
      const market=scoped.filter(row=>row.brand!=="Victorinox"&&inBand(row.currentPrice)).length;
      const own=scoped.filter(row=>row.brand==="Victorinox"&&inBand(row.currentPrice)).length;
      output.push({label:band.label,market,own,from:band.from,to:band.to,share:market+own?own/(market+own)*100:0});
    }
    return output;
  },[rows,category,retailer]);

  const totalGap=opportunities.reduce((sum,item)=>sum+item.gap,0);
  const zeroPresence=opportunities.filter(item=>item.ownSkus===0).length;
  const strongest=opportunities[0]??null;

  return <section className={styles.panel}>
    <div className={styles.panelTitle}>
      <div>
        <span>WHITE SPACES</span>
        <h2>Oportunidades de surtido y cobertura</h2>
        <p>Detecta retailers y categorías donde la profundidad de Victorinox está por debajo del competidor con mayor surtido observado.</p>
      </div>
      <div className={styles.filterRow}>
        <label className={styles.selector}><span>Categoría</span><select value={category} onChange={e=>{setCategory(e.target.value);trackUsageEvent("filter_change",{module:"victorinox-whitespace",metadata:{filter:"category",value:e.target.value||"all"}})}}><option value="">Todas</option>{categories.map(item=><option key={item}>{item}</option>)}</select></label>
        <label className={styles.selector}><span>Retailer</span><select value={retailer} onChange={e=>{setRetailer(e.target.value);trackUsageEvent("filter_change",{module:"victorinox-whitespace",metadata:{filter:"retailer",value:e.target.value||"all"}})}}><option value="">Todos</option>{retailers.map(item=><option key={item}>{item}</option>)}</select></label>
      </div>
    </div>

    <div className={styles.signalGrid}>
      <article><span>BRECHAS DETECTADAS</span><strong>{opportunities.length}</strong><small>retailer × categoría</small></article>
      <article><span>GAP DE SURTIDO</span><strong>{totalGap}</strong><small>SKU vs líderes observados</small></article>
      <article><span>SIN PRESENCIA</span><strong>{zeroPresence}</strong><small>espacios con competencia activa</small></article>
      <article><span>OPORTUNIDAD #1</span><strong>{strongest?.retailer??"—"}</strong><small>{strongest?`${strongest.category} · score ${strongest.score}`:"sin gap relevante"}</small></article>
    </div>

    <div className={styles.opportunityGrid}>
      {opportunities.slice(0,9).map((item,index)=><article key={`${item.retailer}-${item.category}`}>
        <header><span>#{String(index+1).padStart(2,"0")}</span><b className={item.score>=75?styles.scoreHigh:item.score>=45?styles.scoreMid:styles.scoreLow}>{item.score}</b></header>
        <h3>{item.retailer}</h3><p>{item.category}</p>
        <div className={styles.gapBars}>
          <div><span>Victorinox</span><strong>{item.ownSkus} SKU</strong><i style={{width:`${Math.max(4,item.leaderSkus?item.ownSkus/item.leaderSkus*100:0)}%`}}/></div>
          <div><span>{item.leaderBrand}</span><strong>{item.leaderSkus} SKU</strong><i style={{width:"100%"}}/></div>
        </div>
        <footer>Brecha potencial de profundidad: <strong>{item.gap} SKU</strong></footer>
      </article>)}
      {!opportunities.length&&<div className={styles.emptyCompact}>No se detectan brechas de surtido con los filtros actuales.</div>}
    </div>

    <div className={styles.panelTitle}><div><span>PRICE LADDER</span><h2>Espacios por banda de precio</h2><p>Las bandas Entry / Core / Premium se recalculan sobre la distribución de precios de la competencia.</p></div></div>
    <div className={styles.bandGrid}>{priceBandGaps.map(item=><article key={item.label}>
      <span>{item.label.toUpperCase()}</span>
      <h3>{item.share.toFixed(1)}%</h3><p>participación Victorinox en listings observados de la banda</p>
      <div><strong>{item.own} Victorinox</strong><small>{item.market} competencia</small></div>
      <footer>{money.format(Math.round(item.from))} {item.to==null?"en adelante":`– ${money.format(Math.round(item.to))}`}</footer>
    </article>)}</div>

    <div className={styles.methodNote}><strong>Uso recomendado:</strong> estas brechas son señales comerciales para priorizar revisión. No implican automáticamente que todo SKU faltante deba incorporarse; deben cruzarse con estrategia, demanda, margen y disponibilidad.</div>
  </section>;
}
