"use client";
import {useEffect,useState} from "react";
import styles from "./BrandsVertical.module.css";
const clp=new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const pct=(v:any)=>v==null?"—":`${v>=0?"+":""}${Number(v).toFixed(1)}%`;
const label=(v:any)=>v==null?"—":v>=145?"Premium muy alto":v>=120?"Premium":v>=108?"Premium moderado":v>=92?"En línea":"Value";
const brand=(v:string)=>v.split(" ").map(x=>x?x[0].toUpperCase()+x.slice(1):x).join(" ");
export default function BrandsCompetition(){
 const[data,setData]=useState<any>(null),[error,setError]=useState("");
 useEffect(()=>{fetch("/api/brands-competition-v3?brand=victorinox",{credentials:"same-origin"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d}).then(setData).catch(e=>setError(e?.message||"No fue posible cargar competencia"))},[]);
 if(error)return <div className={styles.error}>{error}</div>;
 if(!data)return <div className={styles.state}>Calculando competencia en ClickHouse…</div>;
 const valid=data.categories.filter((x:any)=>x.priceIndex!=null),avg=(k:string)=>valid.length?valid.reduce((a:number,x:any)=>a+Number(x[k]),0)/valid.length:null;
 return <div style={{display:"grid",gap:16}}>
  <div className={styles.kpis}><article><span>Premium estimado</span><strong>{pct(avg("premiumPct"))}</strong></article><article><span>Price Index</span><strong>{avg("priceIndex")?.toFixed(1)||"—"}</strong><small>Mercado = 100</small></article><article><span>Categorías</span><strong>{data.categories.length}</strong></article><article><span>Fuente</span><strong style={{fontSize:16}}>ClickHouse</strong></article></div>
  {data.categories.map((g:any)=><article className={styles.panel} key={g.category}><div className={styles.panelTitle}><div><h2>{g.category}</h2><p>Victorinox vs set competitivo observado.</p></div><span>{label(g.priceIndex)}</span></div><div className={styles.kpis}><article><span>Victorinox</span><strong>{g.own?clp.format(g.own.medianPrice):"—"}</strong></article><article><span>Benchmark</span><strong>{g.benchmarkMedian?clp.format(g.benchmarkMedian):"—"}</strong></article><article><span>Premium</span><strong>{pct(g.premiumPct)}</strong></article><article><span>Price Index</span><strong>{g.priceIndex?.toFixed(1)||"—"}</strong></article></div><div className={styles.tableWrap}><table><thead><tr><th>Marca</th><th>Mediana</th><th>Victorinox vs marca</th><th>Productos</th><th>Retailers</th><th>Promo</th></tr></thead><tbody>{g.competitors.map((c:any)=><tr key={c.brand}><td><strong>{brand(c.brand)}</strong></td><td>{clp.format(c.medianPrice)}</td><td>{pct(c.premiumPct)}</td><td>{c.products}</td><td>{c.retailers}</td><td>{c.promoPct.toFixed(1)}%</td></tr>)}</tbody></table></div></article>)}
  <article className={styles.panel}><p style={{margin:0,color:"#94a3b8",fontSize:11}}>Premium estimado: mediana Victorinox versus mediana de las medianas de las marcas competidoras por categoría. Benchmark categorial; no implica matching SKU-a-SKU.</p></article>
 </div>;
}
