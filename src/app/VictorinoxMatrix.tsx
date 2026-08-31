"use client";
import { useMemo,useState } from "react";
import styles from "./VictorinoxMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

type Row={id:string;retailer:string;brand:string;category:string;currentPrice:number;inStock:boolean};
const money=new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
function avg(v:number[]){return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}

export default function VictorinoxMatrix({rows,categories}:{rows:Row[];categories:string[]}){
 const[retailer,setRetailer]=useState("");
 const retailers=useMemo(()=>[...new Set(rows.map(r=>r.retailer))].sort((a,b)=>a.localeCompare(b,"es")),[rows]);
 const filtered=useMemo(()=>rows.filter(r=>(!retailer||r.retailer===retailer)&&r.currentPrice>0&&r.inStock!==false),[rows,retailer]);
 const brands=useMemo(()=>{const counts=new Map<string,number>();rows.forEach(r=>counts.set(r.brand,(counts.get(r.brand)??0)+1));const sorted=[...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([b])=>b);return [...new Set(["Victorinox",...sorted])].slice(0,14);},[rows]);
 const map=useMemo(()=>{const m=new Map<string,{price:number|null;sku:number}>();for(const brand of brands)for(const category of categories){const cell=filtered.filter(r=>r.brand===brand&&r.category===category);m.set(brand+"::"+category,{price:avg(cell.map(r=>r.currentPrice)),sku:cell.length});}return m;},[brands,categories,filtered]);
 return <section className={styles.panel}>
  <div className={styles.panelTitle}><div><span>MATRIZ COMPETITIVA</span><h2>Precio promedio por marca y categoría</h2><p>Eje X = categorías · Eje Y = principales marcas. Selecciona un retailer y toda la matriz se recalcula.</p></div>
   <label className={styles.selector}><span>Retailer</span><select value={retailer} onChange={e=>{setRetailer(e.target.value);trackUsageEvent("filter_change",{module:"victorinox-market",metadata:{filter:"matrix-retailer",value:e.target.value||"all"}})}}><option value="">Todos · promedio</option>{retailers.map(x=><option key={x}>{x}</option>)}</select></label>
  </div>
  <div className={styles.matrixWrap}><table className={styles.matrix}><thead><tr><th>Marca ↓ / Categoría →</th>{categories.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{brands.map(brand=><tr key={brand}><th>{brand}</th>{categories.map(category=>{const cell=map.get(brand+"::"+category);return <td key={category}>{cell?.price?<><strong>{money.format(Math.round(cell.price))}</strong><small>{cell.sku} SKU</small></>:<span>—</span>}</td>})}</tr>)}</tbody></table></div>
  <div className={styles.matrixFoot}><strong>{retailer||"Todos los retailers"}</strong><span>{filtered.length} observaciones con precio vigente.</span></div>
 </section>;
}
