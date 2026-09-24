"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AutomotiveFinancing.module.css";

type Vehicle = { id:string; brand:string; model:string; version:string; finalPrice:number; cashPrice:number; listPrice:number };
type Offer = {
  id:string; provider:string; sourceType:"auto_finance"|"credit_card"|"consumer_credit"|"benchmark";
  productName:string; brand:string|null; model:string|null; vehiclePrice:number|null; financedPrice:number|null;
  financeBonus:number|null; downPaymentPct:number|null; downPaymentAmount:number|null; termMonths:number|null;
  installmentsCount:number|null; installmentAmount:number|null; balloonAmount:number|null; monthlyRatePct:number|null;
  annualRatePct:number|null; caePct:number|null; loanAmount:number|null; creditTotalCost:number|null;
  vehicleTotalCost:number|null; confidence:"published"|"derived"|"conditions_only"; sourceUrl:string; observedAt:string;
  validUntil:string|null; raw:Record<string,unknown>;
};
type Source = { id:string; provider:string; sourceType:string; productName:string; sourceUrl:string; lastScrapedAt:string|null; lastStatus:string|null; lastError:string|null };
type Payload = { source:"supabase"; asOf:string; offers:Offer[]; sources:Source[]; summary:{providers:number;offers:number;autoFinance:number;creditCards:number;withCae:number;withPublishedRate:number}; methodology:string };
type Segment = "all"|"auto_finance"|"credit_card";

const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const integer = new Intl.NumberFormat("es-CL",{maximumFractionDigits:0});
function fmtMoney(v:number|null|undefined){ return v && v>0 ? money.format(v) : "—"; }
function fmtPct(v:number|null|undefined){ return v===null||v===undefined||!Number.isFinite(v) ? "—" : `${v.toFixed(2).replace(".",",")}%`; }
function annuity(principal:number, monthlyPct:number, months:number){
  if(principal<=0||months<=0)return 0;
  const r=monthlyPct/100;
  return r===0 ? principal/months : principal*r/(1-Math.pow(1+r,-months));
}
function effectiveMonthlyFromCae(cae:number){ return (Math.pow(1+cae/100,1/12)-1)*100; }
function publishedRate(offer:Offer){
  if(offer.monthlyRatePct!==null) return `${fmtPct(offer.monthlyRatePct)} mensual`;
  if(offer.annualRatePct!==null) return `${fmtPct(offer.annualRatePct)} anual`;
  return "No publicada";
}
function confidenceLabel(value:Offer["confidence"]){
  return value==="published" ? "Publicado" : value==="derived" ? "Derivado" : "Sólo condiciones";
}

export default function AutomotiveFinancing({vehicles}:{vehicles:Vehicle[]}) {
  const [payload,setPayload]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [segment,setSegment]=useState<Segment>("all");
  const [selectedVehicle,setSelectedVehicle]=useState("");
  const [manualPrice,setManualPrice]=useState(20000000);
  const [pie,setPie]=useState(30);
  const [term,setTerm]=useState(36);

  useEffect(()=>{
    let active=true;
    fetch("/api/automotive/financing",{credentials:"same-origin"})
      .then(async r=>{if(!r.ok)throw new Error("financing_failed"); return await r.json() as Payload;})
      .then(v=>{if(active)setPayload(v);})
      .catch(()=>{if(active)setError("No fue posible cargar las condiciones de financiamiento.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);

  const vehicleOptions=useMemo(()=>{
    const seen=new Set<string>();
    return vehicles.filter(v=>{
      const key=`${v.brand}|${v.model}|${v.version}`;
      if(seen.has(key)||v.finalPrice<=0)return false;
      seen.add(key); return true;
    }).sort((a,b)=>a.brand.localeCompare(b.brand,"es")||a.model.localeCompare(b.model,"es")||a.finalPrice-b.finalPrice).slice(0,1200);
  },[vehicles]);

  const chosen=vehicleOptions.find(v=>v.id===selectedVehicle);
  const vehiclePrice=chosen?.finalPrice||manualPrice;
  const downPayment=vehiclePrice*Math.max(0,Math.min(90,pie))/100;
  const principal=Math.max(0,vehiclePrice-downPayment);

  const rows=useMemo(()=>{
    const offers=(payload?.offers||[]).filter(o=>segment==="all"||o.sourceType===segment);
    return offers.map(o=>{
      const monthly=o.monthlyRatePct!==null ? o.monthlyRatePct : o.caePct!==null ? effectiveMonthlyFromCae(o.caePct) : null;
      const comparable=o.confidence!=="conditions_only" && monthly!==null && o.sourceType!=="benchmark";
      const payment=comparable ? annuity(principal,monthly!,term) : null;
      const total=payment!==null ? downPayment+payment*term : null;
      const delta=total!==null ? total-vehiclePrice : null;
      const basis=o.monthlyRatePct!==null ? "tasa mensual" : o.caePct!==null ? "CAE equivalente" : "";
      return {...o,simMonthly:monthly,simPayment:payment,simTotal:total,simDelta:delta,simBasis:basis};
    }).sort((a,b)=>{
      if(a.simTotal!==null&&b.simTotal!==null)return a.simTotal-b.simTotal;
      if(a.simTotal!==null)return -1;if(b.simTotal!==null)return 1;
      return a.provider.localeCompare(b.provider,"es");
    });
  },[payload,segment,principal,term,downPayment,vehiclePrice]);

  const comparable=rows.filter(r=>r.simTotal!==null);
  const best=comparable[0]||null;
  const published=rows.filter(r=>r.confidence==="published").length;
  const sourceOk=(payload?.sources||[]).filter(s=>s.lastStatus==="ok").length;

  return <div className={styles.root}>
    <section className={styles.simulator}>
      <div className={styles.simHeader}>
        <div><span>SIMULADOR NORMALIZADO</span><h2>Mismo auto, mismo pie, mismo plazo</h2><p>Separa la condición publicada de una simulación comparable. No reemplaza una cotización ni evaluación crediticia.</p></div>
        <div className={styles.liveBadge}><i/> Fuentes públicas + histórico</div>
      </div>
      <div className={styles.controls}>
        <label>Vehículo
          <select value={selectedVehicle} onChange={e=>{
            setSelectedVehicle(e.target.value);
            const selected=vehicleOptions.find(x=>x.id===e.target.value);
            if(selected?.finalPrice)setManualPrice(selected.finalPrice);
          }}>
            <option value="">Monto manual</option>
            {vehicleOptions.map(v=><option key={v.id} value={v.id}>{v.brand} {v.model} · {v.version} · {money.format(v.finalPrice)}</option>)}
          </select>
        </label>
        <label>Precio del vehículo
          <input type="number" min="3000000" step="100000" value={Math.round(vehiclePrice)} disabled={Boolean(chosen)} onChange={e=>setManualPrice(Math.max(0,Number(e.target.value)||0))}/>
        </label>
        <label>Pie
          <select value={pie} onChange={e=>setPie(Number(e.target.value))}>{[0,10,20,30,40,50].map(v=><option key={v} value={v}>{v}%</option>)}</select>
        </label>
        <label>Plazo comparable
          <select value={term} onChange={e=>setTerm(Number(e.target.value))}>{[12,24,25,36,48,60].map(v=><option key={v} value={v}>{v} meses</option>)}</select>
        </label>
      </div>
      <div className={styles.mathline}>
        <span>Precio <b>{money.format(vehiclePrice)}</b></span><i>−</i>
        <span>Pie <b>{money.format(downPayment)}</b></span><i>=</i>
        <span>Monto comparable <strong>{money.format(principal)}</strong></span>
      </div>
    </section>

    <div className={styles.segmentTabs}>
      <button className={segment==="all"?styles.active:""} onClick={()=>setSegment("all")}>Todas</button>
      <button className={segment==="auto_finance"?styles.active:""} onClick={()=>setSegment("auto_finance")}>Financieras automotrices</button>
      <button className={segment==="credit_card"?styles.active:""} onClick={()=>setSegment("credit_card")}>Tarjetas de crédito</button>
    </div>

    {loading?<div className={styles.state}>Leyendo condiciones vigentes…</div>:null}
    {!loading&&error?<div className={styles.error}>{error}</div>:null}
    {!loading&&!error&&payload?<>
      <div className={styles.kpis}>
        <article><span>Proveedores cubiertos</span><strong>{integer.format(payload.summary.providers||0)}</strong><small>{payload.sources.length} fuentes registradas</small></article>
        <article><span>Ofertas publicadas</span><strong>{published}</strong><small>con condición estructurada</small></article>
        <article><span>Con tasa / CAE</span><strong>{payload.summary.withPublishedRate+payload.summary.withCae}</strong><small>pueden alimentar comparación</small></article>
        <article><span>Fuentes actualizadas OK</span><strong>{sourceOk}/{payload.sources.length}</strong><small>última corrida automática</small></article>
        <article><span>Menor costo simulado</span><strong>{best?money.format(best.simTotal!):"—"}</strong><small>{best?best.provider:"sin tasa comparable"}</small></article>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Comparativa de financiamiento</h2><p>Los valores “publicados” vienen de la fuente. “Comparable” recalcula sobre {money.format(principal)} y {term} meses.</p></div><b>{rows.length} alternativas</b></div>
        <div className={styles.tableShell}><table>
          <thead><tr><th>Entidad / producto</th><th>Tipo</th><th>Tasa publicada</th><th>CAE</th><th>Pie / plazo publicado</th><th>Bono</th><th>Cuota publicada</th><th>Cuotón</th><th>CTC publicado</th><th>Cuota comparable</th><th>Costo comparable</th><th></th></tr></thead>
          <tbody>{rows.map((r,index)=><tr key={r.id}>
            <td className={styles.entity}><span>{r.provider}</span><strong>{r.productName}</strong>{r.brand?<small>{r.brand}{r.model?` · ${r.model}`:""}</small>:null}</td>
            <td><span className={r.sourceType==="credit_card"?styles.cardPill:styles.financePill}>{r.sourceType==="credit_card"?"Tarjeta":r.sourceType==="auto_finance"?"Automotriz":"Benchmark"}</span><small className={styles.confidence}>{confidenceLabel(r.confidence)}</small></td>
            <td>{publishedRate(r)}</td><td>{fmtPct(r.caePct)}</td>
            <td>{r.downPaymentPct!==null?`${fmtPct(r.downPaymentPct)} pie · `:""}{r.termMonths?`${r.termMonths} m`:"—"}</td>
            <td className={styles.good}>{fmtMoney(r.financeBonus)}</td>
            <td>{fmtMoney(r.installmentAmount)}</td><td>{fmtMoney(r.balloonAmount)}</td><td>{fmtMoney(r.creditTotalCost)}</td>
            <td>{r.simPayment!==null?<><strong>{money.format(r.simPayment)}</strong><small className={styles.simBasis}>{r.simBasis}</small></>:"—"}</td>
            <td className={r.simTotal!==null&&index===0?styles.best:""}>{r.simTotal!==null?<><strong>{money.format(r.simTotal)}</strong><small className={r.simDelta!==null&&r.simDelta>0?styles.cost:styles.saving}>{r.simDelta===null?"":`${r.simDelta>=0?"+":"−"} ${money.format(Math.abs(r.simDelta))} vs precio`}</small></>:"—"}</td>
            <td><a href={r.sourceUrl} target="_blank" rel="noreferrer">Fuente ↗</a></td>
          </tr>)}</tbody>
        </table></div>
        <p className={styles.disclaimer}>La simulación comparable usa la tasa mensual publicada o, cuando sólo existe CAE, una tasa mensual equivalente derivada del CAE. Sirve para homologar escenarios; no reproduce seguros, comisiones, cupos, promociones ni criterios de riesgo particulares. Las tarjetas requieren cupo disponible y las promociones pueden limitar comercios o segmentos.</p>
      </section>

      <section className={styles.coverage}>
        <div className={styles.panelHeader}><div><h2>Cobertura de fuentes</h2><p>Estado operativo del crawler diario.</p></div><span>Actualización diaria</span></div>
        <div className={styles.sourceGrid}>{payload.sources.map(s=><a key={s.id} href={s.sourceUrl} target="_blank" rel="noreferrer">
          <div><strong>{s.provider}</strong><small>{s.productName}</small></div>
          <span className={s.lastStatus==="ok"?styles.ok:s.lastStatus==="error"?styles.bad:styles.pending}>{s.lastStatus==="ok"?"OK":s.lastStatus==="error"?"Error":"Pendiente"}</span>
        </a>)}</div>
      </section>
    </>:null}
  </div>;
}
