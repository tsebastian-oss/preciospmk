"use client";
import {useEffect,useState} from "react";
import styles from "./BrandsVertical.module.css";

type P={date:string;ownMedian:number;benchmarkMedian:number;priceIndex:number;premiumPct:number;ownProducts:number;competitorProducts:number;competitorBrands:number};
type G={category:string;points:P[]};
type D={categories:G[];error?:string};
const clp=new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const pct=(v:number)=>`${v>=0?"+":""}${v.toFixed(1)}%`;
const delta=(a:number,b:number)=>a?((b/a)-1)*100:0;
const date=(v:string)=>new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"short"}).format(new Date(v+"T12:00:00")).replace(".","");

function Chart({g}:{g:G}){
 const p=g.points;if(p.length<2)return <article className={styles.panel}><h2>{g.category}</h2><p>Sin histórico comparable suficiente.</p></article>;
 const first=p[0],last=p[p.length-1],vals=p.flatMap(x=>[x.ownMedian,x.benchmarkMedian]);
 const lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max((hi-lo)*.15,hi*.05,500),min=Math.max(0,lo-pad),max=hi+pad,w=760,h=190;
 const x=(i:number)=>24+i/Math.max(1,p.length-1)*(w-48),y=(v:number)=>18+(max-v)/Math.max(1,max-min)*(h-42);
 const path=(k:"ownMedian"|"benchmarkMedian")=>p.map((q,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(q[k]).toFixed(1)}`).join(" ");
 return <article className={styles.panel}>
  <div className={styles.panelTitle}><div><h2>{g.category}</h2><p>Victorinox vs benchmark competitivo diario.</p></div><span>Index {last.priceIndex.toFixed(1)} · {pct(last.premiumPct)}</span></div>
  <div className={styles.kpis}><article><span>Victorinox</span><strong>{clp.format(last.ownMedian)}</strong><small>{pct(delta(first.ownMedian,last.ownMedian))} período</small></article><article><span>Competencia</span><strong>{clp.format(last.benchmarkMedian)}</strong><small>{pct(delta(first.benchmarkMedian,last.benchmarkMedian))} período</small></article><article><span>Premium</span><strong>{pct(last.premiumPct)}</strong></article><article><span>Price Index</span><strong>{last.priceIndex.toFixed(1)}</strong><small>mercado = 100</small></article></div>
  <div style={{display:"flex",gap:16,fontSize:10,color:"#94a3b8",margin:"12px 0 4px"}}><span>━ Victorinox</span><span>┅ Benchmark competencia</span></div>
  <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",display:"block"}} role="img" aria-label={`Evolución de precios ${g.category}`}>
   {[.25,.5,.75].map(t=><line key={t} x1="24" x2={w-24} y1={18+t*(h-42)} y2={18+t*(h-42)} stroke="rgba(148,163,184,.1)"/>)}
   <path d={path("benchmarkMedian")} fill="none" stroke="#a78bfa" strokeWidth="3" strokeDasharray="7 5" vectorEffect="non-scaling-stroke"/>
   <path d={path("ownMedian")} fill="none" stroke="#58ddff" strokeWidth="3.5" vectorEffect="non-scaling-stroke"/>
   <text x="24" y={h-5} fill="#64748b" fontSize="10">{date(first.date)}</text><text x={w-24} y={h-5} textAnchor="end" fill="#64748b" fontSize="10">{date(last.date)}</text>
  </svg>
  <small style={{display:"block",color:"#64748b",marginTop:6}}>{p.length} días comparables · última muestra {last.ownProducts} SKU Victorinox vs {last.competitorProducts} SKU de {last.competitorBrands} marcas</small>
 </article>;
}

export default function BrandsCompetitionHistory(){
 const[days,setDays]=useState(90),[data,setData]=useState<D|null>(null),[error,setError]=useState("");
 useEffect(()=>{const c=new AbortController();setError("");fetch(`/api/brands-competition-history-v3?days=${days}`,{credentials:"same-origin",signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d}).then(setData).catch(e=>{if(e?.name!=="AbortError")setError(e?.message||"No fue posible cargar la evolución")});return()=>c.abort()},[days]);
 return <section style={{display:"grid",gap:16}}><article className={styles.panel}><div className={styles.panelTitle}><div><h2>Evolución de precios vs competencia</h2><p>Relojes, Maletas y Cuchillos · mediana diaria.</p></div><div style={{display:"flex",gap:6}}>{[30,90,180].map(d=><button key={d} onClick={()=>setDays(d)} style={{padding:"6px 9px",borderRadius:8,border:"1px solid rgba(148,163,184,.16)",background:days===d?"rgba(88,221,255,.12)":"transparent",color:days===d?"#dff8ff":"#94a3b8",cursor:"pointer"}}>{d}D</button>)}</div></div><small style={{color:"#64748b"}}>Benchmark = mediana de las medianas por marca competidora; evita sesgos por cantidad de SKU.</small></article>{error?<div className={styles.error}>{error}</div>:!data?<div className={styles.state}>Construyendo evolución en ClickHouse…</div>:data.categories.map(g=><Chart key={g.category} g={g}/>)}</section>;
}
