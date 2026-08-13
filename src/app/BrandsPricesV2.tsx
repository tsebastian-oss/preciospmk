"use client";
import {useEffect,useMemo,useState} from "react";
import styles from "./BrandsVertical.module.css";
type Row={category:string;date:string;medianPrice:number;averagePrice:number;products:number};
type Data={rows:Row[];error?:string};
const clp=new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const change=(a?:Row,b?:Row)=>a&&b&&a.medianPrice>0?`${b.medianPrice>=a.medianPrice?"+":""}${((b.medianPrice/a.medianPrice-1)*100).toFixed(1)}%`:"—";
export default function BrandsPricesV2(){
 const[days,setDays]=useState(90),[data,setData]=useState<Data|null>(null),[error,setError]=useState("");
 useEffect(()=>{const c=new AbortController();fetch(`/api/brands-prices-v1?brand=victorinox&days=${days}`,{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"No fue posible cargar precios");setData(d);setError("")}).catch(e=>{if(!(e instanceof DOMException&&e.name==="AbortError"))setError(e instanceof Error?e.message:"Error cargando precios")});return()=>c.abort()},[days]);
 const groups=useMemo(()=>{const rows=(data?.rows??[]).filter(r=>r.category!=="__ALL__"),names=[...new Set(rows.map(r=>r.category))];return names.map(name=>({name,rows:rows.filter(r=>r.category===name)})).sort((a,b)=>(b.rows.at(-1)?.products??0)-(a.rows.at(-1)?.products??0))},[data]);
 if(error)return <div className={styles.error}>{error}</div>;if(!data)return <div className={styles.state}>Cargando histórico de precios…</div>;
 const overall=data.rows.filter(r=>r.category==="__ALL__"),first=overall[0],last=overall.at(-1);
 return <div style={{display:"grid",gap:16}}><div className={styles.filters}><select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={30}>30 días</option><option value={90}>90 días</option><option value={180}>180 días</option></select></div><div className={styles.kpis}><article><span>Mediana actual</span><strong>{last?clp.format(last.medianPrice):"—"}</strong></article><article><span>Variación</span><strong>{change(first,last)}</strong></article><article><span>SKU observados</span><strong>{last?.products??0}</strong></article><article><span>Última fecha</span><strong style={{fontSize:16}}>{last?.date??"—"}</strong></article></div><article className={styles.panel}><div className={styles.panelTitle}><div><h2>Precios históricos por categoría</h2><p>ClickHouse · fecha + marca · mediana diaria.</p></div></div><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th><th>Inicio</th><th>Actual</th><th>Variación</th><th>SKU</th><th>Fecha</th></tr></thead><tbody>{groups.slice(0,20).map(g=>{const a=g.rows[0],b=g.rows.at(-1);return <tr key={g.name}><td><strong>{g.name}</strong></td><td>{a?clp.format(a.medianPrice):"—"}</td><td>{b?clp.format(b.medianPrice):"—"}</td><td>{change(a,b)}</td><td>{b?.products??0}</td><td>{b?.date??"—"}</td></tr>})}</tbody></table></div></article></div>;
}
