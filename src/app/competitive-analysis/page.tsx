"use client";

import { useMemo, useState, type FormEvent } from "react";
import styles from "./competitive-analysis.module.css";

type Product = { id:string; supermarket:string; name:string; brand:string|null; category:string|null; url:string; regular_price:number|string|null; offer_price:number|string; };
type Relationship = "equivalent"|"direct_competitor"|"substitute";
type Competitor = Product & { relationship:Relationship; similarity:number; confidence:"high"|"medium"|"low"; reasons:string[]; warnings:string[]; price_gap:number; };
type Analysis = {
  target:Product;
  competitors:Competitor[];
  metrics:{ referencePrice:number; marketMedian:number; marketMin:number; marketMax:number; rank:number; totalRanked:number; recommendedMin:number; recommendedMax:number; gapVsCheapest:number; position:{ code:"low"|"equal"|"high"|"overpriced"; label:string; diffPct:number }; equivalentCount:number; directCount:number; substituteCount:number };
  ai:{ enabled:boolean; explanation:string; actions:string[]; risks:string[] };
};

const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const labels:Record<Relationship,string>={equivalent:"Equivalente",direct_competitor:"Competidor directo",substitute:"Sustituto"};
function price(p:Product){const offer=Number(p.offer_price||0);return offer>0?offer:Number(p.regular_price||0);}

export default function CompetitiveAnalysisPage(){
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<Product[]>([]);
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [filter,setFilter]=useState<Relationship|"all">("all");

  async function search(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); if(query.trim().length<2)return;
    setLoading(true);setError("");setAnalysis(null);
    try{const response=await fetch(`/api/competitive-analysis?q=${encodeURIComponent(query.trim())}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"No fue posible buscar productos");setResults(data.searchResults||[]);}catch(cause){setError(cause instanceof Error?cause.message:"Error de búsqueda");}finally{setLoading(false);}
  }
  async function analyze(id:string){
    setLoading(true);setError("");setFilter("all");
    try{const response=await fetch(`/api/competitive-analysis?productId=${encodeURIComponent(id)}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"No fue posible analizar el producto");setAnalysis(data);setResults([]);}catch(cause){setError(cause instanceof Error?cause.message:"Error de análisis");}finally{setLoading(false);}
  }
  const visible=useMemo(()=>!analysis?[]:filter==="all"?analysis.competitors:analysis.competitors.filter(item=>item.relationship===filter),[analysis,filter]);

  return <main className={styles.page}>
    <header className={styles.header}><div><span>MGP RETAIL INTELLIGENCE · IA</span><h1>Competitive Pricing Intelligence</h1><p>Detecta automáticamente equivalentes, competidores directos y sustitutos entre cadenas.</p></div><a href="/">Volver al dashboard</a></header>
    <form className={styles.search} onSubmit={search}><input value={query} onChange={(event:{target:{value:string}})=>setQuery(event.target.value)} placeholder="Busca un producto o marca"/><button disabled={loading||query.trim().length<2}>{loading?"Procesando…":"Buscar"}</button></form>
    {error&&<div className={styles.error}>{error}</div>}
    {results.length>0&&<section className={styles.results}><h2>Selecciona el producto de referencia</h2><div>{results.map(product=><button type="button" key={product.id} onClick={()=>analyze(product.id)}><span><strong>{product.name}</strong><small>{product.supermarket} · {product.brand||"Sin marca"}</small></span><b>{money.format(price(product))}</b></button>)}</div></section>}
    {analysis&&<>
      <section className={styles.hero}>
        <article><span>PRODUCTO ANALIZADO</span><h2>{analysis.target.name}</h2><p>{analysis.target.supermarket} · {analysis.target.brand||"Sin marca"}</p><strong>{money.format(analysis.metrics.referencePrice)}</strong></article>
        <article className={styles[analysis.metrics.position.code]}><span>POSICIÓN DE PRECIO</span><strong>{analysis.metrics.position.diffPct>=0?"+":""}{analysis.metrics.position.diffPct.toFixed(1)}%</strong><h2>{analysis.metrics.position.label}</h2><p>Rango sugerido {money.format(analysis.metrics.recommendedMin)}–{money.format(analysis.metrics.recommendedMax)}</p></article>
        <article><span>{analysis.ai.enabled?"ANÁLISIS GENERATIVO":"MOTOR HÍBRIDO"}</span><p className={styles.explanation}>{analysis.ai.explanation}</p>{analysis.ai.actions.length>0&&<ul>{analysis.ai.actions.map(action=><li key={action}>{action}</li>)}</ul>}</article>
      </section>
      <section className={styles.metrics}><article><span>Mediana</span><strong>{money.format(analysis.metrics.marketMedian)}</strong></article><article><span>Mínimo</span><strong>{money.format(analysis.metrics.marketMin)}</strong></article><article><span>Ranking</span><strong>{analysis.metrics.rank||"—"} / {analysis.metrics.totalRanked}</strong></article><article><span>Set competitivo</span><strong>{analysis.competitors.length}</strong></article></section>
      <section className={styles.competitors}>
        <div className={styles.titleRow}><div><span>COMPETITIVE SET</span><h2>Productos detectados</h2></div><div><button className={filter==="all"?styles.active:""} onClick={()=>setFilter("all")}>Todos</button>{(["equivalent","direct_competitor","substitute"] as Relationship[]).map(type=><button key={type} className={filter===type?styles.active:""} onClick={()=>setFilter(type)}>{labels[type]}</button>)}</div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Cadena</th><th>Relación</th><th>Confianza</th><th>Precio</th><th>Brecha</th><th></th></tr></thead><tbody>{visible.map(item=><tr key={item.id}><td><strong>{item.name}</strong><small>{item.reasons.join(" · ")}</small>{item.warnings.length>0&&<em>{item.warnings.join(" · ")}</em>}</td><td>{item.supermarket}</td><td><span className={styles.tag}>{labels[item.relationship]}</span></td><td>{item.similarity.toFixed(1)}% · {item.confidence}</td><td>{money.format(price(item))}</td><td className={item.price_gap>0?styles.expensive:styles.cheaper}>{item.price_gap>0?"+":""}{money.format(item.price_gap)}</td><td><a href={item.url} target="_blank" rel="noreferrer">Ver ↗</a></td></tr>)}</tbody></table></div>
      </section>
    </>}
  </main>;
}
