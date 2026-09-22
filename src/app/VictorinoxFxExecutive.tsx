"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./VictorinoxFxExecutive.module.css";

type FxPoint = { date:string; chfClp:number; usdClp:number; chfUsd:number };
type Period = { days:number; baseline:FxPoint; chfClpChangePct:number; usdClpChangePct:number; relativeChfPressurePct:number };
type FxPayload = {
  asOf:string;
  fetchedAt:string;
  source:{ label:string; frequency:"business-day" };
  summary:{ current:FxPoint; periods:Period[] };
  points:FxPoint[];
  error?:string;
};
export type VictorinoxFxPosition = {
  category:string;
  own:{ medianPrice:number|null }|null;
  comparableBenchmarkMedian:number|null;
  comparablePriceIndex:number|null;
};

type Assumptions = {
  baselineMargin:number;
  exposedCost:number;
  chfWeight:number;
  passThrough:number;
};

const DEFAULTS:Assumptions={baselineMargin:45,exposedCost:70,chfWeight:75,passThrough:0};
const CLP=new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const NUMBER=new Intl.NumberFormat("es-CL",{maximumFractionDigits:2});
const STORAGE_KEY="victorinox-fx-scenario-v1";

function pct(value:number,decimals=1){return `${value>0?"+":""}${value.toFixed(decimals)}%`;}
function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value));}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}

function FxChart({points}:{points:FxPoint[]}){
  if(points.length<2)return <div className={styles.empty}>Sin histórico suficiente.</div>;
  const first=points[0];
  const normalized=points.map(point=>({
    ...point,
    chfIndex:point.chfClp/first.chfClp*100,
    usdIndex:point.usdClp/first.usdClp*100,
  }));
  const values=normalized.flatMap(point=>[point.chfIndex,point.usdIndex]);
  const min=Math.min(...values)-2,max=Math.max(...values)+2;
  const w=760,h=250,l=44,r=18,t=18,b=32;
  const x=(index:number)=>l+index/Math.max(1,normalized.length-1)*(w-l-r);
  const y=(value:number)=>t+(max-value)/Math.max(1,max-min)*(h-t-b);
  const path=(key:"chfIndex"|"usdIndex")=>normalized.map((point,index)=>`${index?"L":"M"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const last=normalized.at(-1)!;
  return <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Evolución normalizada del CHF/CLP y USD/CLP entre ${dateLabel(first.date)} y ${dateLabel(last.date)}`}>
      {[0,.5,1].map(step=>{const value=min+(max-min)*step;return <g key={step}><line x1={l} x2={w-r} y1={y(value)} y2={y(value)} className={styles.gridLine}/><text x={l-8} y={y(value)+3} textAnchor="end">{value.toFixed(0)}</text></g>})}
      <path d={path("usdIndex")} className={styles.usdLine}/>
      <path d={path("chfIndex")} className={styles.chfLine}/>
      <text x={l} y={h-8}>{dateLabel(first.date)}</text><text x={w-r} y={h-8} textAnchor="end">{dateLabel(last.date)}</text>
    </svg>
    <div className={styles.legend}><span><i className={styles.chfDot}/>CHF/CLP <b>{last.chfIndex.toFixed(1)}</b></span><span><i className={styles.usdDot}/>USD/CLP <b>{last.usdIndex.toFixed(1)}</b></span><small>Base 100 al inicio del período</small></div>
  </div>;
}

function Slider({label,value,onChange,suffix="%",hint}:{label:string;value:number;onChange:(value:number)=>void;suffix?:string;hint:string}){
  return <label className={styles.control}>
    <span>{label}<output>{NUMBER.format(value)}{suffix}</output></span>
    <input type="range" min="0" max="100" step="1" value={value} onChange={event=>onChange(Number(event.target.value))}/>
    <small>{hint}</small>
  </label>;
}

export default function VictorinoxFxExecutive({positions}:{positions:VictorinoxFxPosition[]}){
  const [data,setData]=useState<FxPayload|null>(null);
  const [error,setError]=useState("");
  const [days,setDays]=useState(90);
  const [assumptions,setAssumptions]=useState<Assumptions>(DEFAULTS);
  const [language,setLanguage]=useState<"es"|"en">("es");
  const [copied,setCopied]=useState(false);

  useEffect(()=>{
    try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)setAssumptions({...DEFAULTS,...JSON.parse(saved)});}catch{/* use defaults */}
    const controller=new AbortController();
    fetch("/api/brands/victorinox/fx?days=400",{credentials:"same-origin",signal:controller.signal})
      .then(async response=>{const json=await response.json();if(!response.ok)throw new Error(json.error||"No fue posible cargar FX.");return json as FxPayload;})
      .then(setData)
      .catch(reason=>{if(reason.name!=="AbortError")setError(reason.message);});
    return()=>controller.abort();
  },[]);

  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(assumptions));}catch{/* persistence is optional */}},[assumptions]);

  const analysis=useMemo(()=>{
    if(!data)return null;
    const period=data.summary.periods.find(item=>item.days===days)??data.summary.periods[1];
    if(!period)return null;
    const current=data.summary.current,baseline=period.baseline;
    const chfFactor=current.chfClp/baseline.chfClp;
    const usdFactor=current.usdClp/baseline.usdClp;
    const chfWeight=assumptions.chfWeight/100;
    const exposed=assumptions.exposedCost/100;
    const basketFactor=chfFactor*chfWeight+usdFactor*(1-chfWeight);
    const cogsFactor=1+exposed*(basketFactor-1);
    const priceFactor=1+(assumptions.passThrough/100)*(cogsFactor-1);
    const baselineMargin=assumptions.baselineMargin/100;
    const projectedMargin=(1-((1-baselineMargin)*cogsFactor/priceFactor))*100;
    const marginChange=projectedMargin-assumptions.baselineMargin;
    const requiredPrice=(cogsFactor-1)*100;
    const x0=baseline.usdClp,x1=current.usdClp,y0=baseline.chfUsd,y1=current.chfUsd;
    const baseProduct=x0*y0;
    const pesoContribution=(x1-x0)*(y0+y1)/2/baseProduct*100;
    const francContribution=(y1-y0)*(x0+x1)/2/baseProduct*100;
    const filtered=data.points.filter(point=>point.date>=baseline.date);
    return {period,current,baseline,basketChange:(basketFactor-1)*100,cogsChange:(cogsFactor-1)*100,priceFactor,projectedMargin,marginChange,requiredPrice,pesoContribution,francContribution,filtered};
  },[data,days,assumptions]);

  const brief=useMemo(()=>{
    if(!analysis)return "";
    const category=positions.filter(item=>item.comparablePriceIndex!=null).sort((a,b)=>(b.comparablePriceIndex??0)-(a.comparablePriceIndex??0))[0];
    if(language==="en")return `Chile FX pressure — ${days} days. CHF/CLP moved ${pct(analysis.period.chfClpChangePct)}, explained by approximately ${pct(analysis.pesoContribution)} from CLP/USD and ${pct(analysis.francContribution)} from CHF/USD. Under the editable scenario, FX-linked landed cost changes ${pct(analysis.cogsChange)}. With ${assumptions.passThrough}% pass-through, estimated gross margin moves from ${assumptions.baselineMargin.toFixed(1)}% to ${analysis.projectedMargin.toFixed(1)}% (${analysis.marginChange.toFixed(1)} pp). Preserving the baseline margin would require an estimated list-price adjustment of ${pct(analysis.requiredPrice)}${category?`; the highest current comparable price position is ${category.category} at index ${category.comparablePriceIndex?.toFixed(1)}`:""}. Scenario only; validate against actual COGS, hedges and channel economics.`;
    return `Presión cambiaria Chile — últimos ${days} días. CHF/CLP varió ${pct(analysis.period.chfClpChangePct)}, explicado aproximadamente por ${pct(analysis.pesoContribution)} desde CLP/USD y ${pct(analysis.francContribution)} desde CHF/USD. Bajo el escenario editable, el costo expuesto a FX cambia ${pct(analysis.cogsChange)}. Con ${assumptions.passThrough}% de traspaso, el margen bruto estimado pasa de ${assumptions.baselineMargin.toFixed(1)}% a ${analysis.projectedMargin.toFixed(1)}% (${analysis.marginChange.toFixed(1)} pp). Proteger el margen requeriría un ajuste estimado de lista de ${pct(analysis.requiredPrice)}${category?`; la mayor posición comparable actual es ${category.category}, índice ${category.comparablePriceIndex?.toFixed(1)}`:""}. Escenario ilustrativo; validar con COGS, coberturas y economía real del canal.`;
  },[analysis,positions,language,days,assumptions]);

  if(error)return <section className={styles.shell} aria-labelledby="fx-title"><div className={styles.error}><strong>Contexto cambiario temporalmente no disponible</strong><span>{error}</span><small>El resto del dashboard continúa operativo.</small></div></section>;
  if(!data||!analysis)return <section className={styles.shell} aria-labelledby="fx-title" aria-busy="true"><div className={styles.loading}>Cargando contexto cambiario para HQ…</div></section>;

  const update=(key:keyof Assumptions)=>(value:number)=>setAssumptions(current=>({...current,[key]:clamp(value,0,100)}));
  return <section className={styles.shell} aria-labelledby="fx-title">
    <header className={styles.header}>
      <div><span>HQ EXECUTIVE BRIEF · FX & PROFITABILITY</span><h2 id="fx-title">Presión cambiaria y posición competitiva en Chile</h2><p>Último dato diario disponible, histórico y escenario editable para traducir CHF/CLP y USD/CLP a costo, margen y precio.</p></div>
      <div className={styles.freshness}><span>ACTUALIZADO</span><strong>{dateLabel(data.asOf)}</strong><small>{data.source.label}</small></div>
    </header>

    <div className={styles.periods} role="group" aria-label="Período de análisis">{[30,90,365].map(value=><button key={value} aria-pressed={days===value} onClick={()=>setDays(value)}>{value===365?"1 año":`${value} días`}</button>)}</div>

    <dl className={styles.kpis}>
      <div><dt>CHF/CLP</dt><dd>{CLP.format(analysis.current.chfClp)}</dd><small>{pct(analysis.period.chfClpChangePct)} en {days===365?"1 año":`${days} días`}</small></div>
      <div><dt>USD/CLP</dt><dd>{CLP.format(analysis.current.usdClp)}</dd><small>{pct(analysis.period.usdClpChangePct)} en {days===365?"1 año":`${days} días`}</small></div>
      <div><dt>Presión costo FX</dt><dd>{pct(analysis.cogsChange)}</dd><small>{assumptions.exposedCost}% del costo expuesto · mix {assumptions.chfWeight}% CHF</small></div>
      <div><dt>Margen estimado</dt><dd className={analysis.marginChange<0?styles.risk:styles.positive}>{analysis.projectedMargin.toFixed(1)}%</dd><small>{analysis.marginChange.toFixed(1)} pp vs base modelada</small></div>
      <div><dt>Ajuste para proteger margen</dt><dd>{pct(analysis.requiredPrice)}</dd><small>antes de efectos de volumen y competencia</small></div>
    </dl>

    <div className={styles.mainGrid}>
      <article className={styles.chartCard}>
        <div className={styles.cardTitle}><div><span>ÍNDICE FX · BASE 100</span><h3>Franco suizo versus dólar en pesos chilenos</h3></div><small>CHF/CLP = USD/CLP × CHF/USD</small></div>
        <FxChart points={analysis.filtered}/>
        <div className={styles.contributions}><span>Movimiento CHF/CLP</span><div><b>Peso chileno</b><strong>{pct(analysis.pesoContribution)}</strong></div><div><b>Franco vs dólar</b><strong>{pct(analysis.francContribution)}</strong></div></div>
      </article>

      <aside className={styles.simulator} aria-label="Simulador financiero">
        <div className={styles.cardTitle}><div><span>ESCENARIO EDITABLE</span><h3>Sensibilidad de margen</h3></div><button onClick={()=>setAssumptions(DEFAULTS)}>Restablecer</button></div>
        <Slider label="Margen bruto base" value={assumptions.baselineMargin} onChange={update("baselineMargin")} hint="Supuesto; reemplazar por margen real."/>
        <Slider label="Costo expuesto a FX" value={assumptions.exposedCost} onChange={update("exposedCost")} hint="Participación del costo afectada por monedas."/>
        <Slider label="Mix CHF del costo FX" value={assumptions.chfWeight} onChange={update("chfWeight")} hint={`Resto modelado en USD: ${100-assumptions.chfWeight}%`}/>
        <Slider label="Traspaso a precio" value={assumptions.passThrough} onChange={update("passThrough")} hint="0% absorbe; 100% protege el margen modelado."/>
        <div className={styles.formula}><span>Resultado del escenario</span><strong>{analysis.projectedMargin.toFixed(1)}% margen</strong><small>{pct(analysis.marginChange,1)} pp · costo FX {pct(analysis.cogsChange)}</small></div>
      </aside>
    </div>

    <article className={styles.competitiveCard}>
      <div className={styles.cardTitle}><div><span>PRECIO VS COMPETENCIA</span><h3>Qué ocurriría si se traspasa el escenario actual</h3></div><small>Price Index comparable · mercado = 100</small></div>
      <div className={styles.tableWrap}><table><caption className={styles.srOnly}>Impacto cambiario modelado por categoría</caption><thead><tr><th>Categoría</th><th>Mediana Victorinox</th><th>Benchmark</th><th>Índice actual</th><th>Precio con traspaso</th><th>Índice proyectado</th></tr></thead><tbody>{positions.map(item=>{
        const projected=item.own?.medianPrice?item.own.medianPrice*analysis.priceFactor:null;
        const projectedIndex=projected&&item.comparableBenchmarkMedian?projected/item.comparableBenchmarkMedian*100:null;
        return <tr key={item.category}><td><strong>{item.category}</strong></td><td>{item.own?.medianPrice?CLP.format(item.own.medianPrice):"—"}</td><td>{item.comparableBenchmarkMedian?CLP.format(item.comparableBenchmarkMedian):"—"}</td><td>{item.comparablePriceIndex?.toFixed(1)??"—"}</td><td>{projected?CLP.format(projected):"—"}</td><td><strong>{projectedIndex?.toFixed(1)??"—"}</strong></td></tr>;
      })}</tbody></table></div>
    </article>

    <article className={styles.brief}>
      <div className={styles.cardTitle}><div><span>BRIEF PARA HQ</span><h3>Mensaje ejecutivo listo para presentar</h3></div><div className={styles.briefActions}><button aria-pressed={language==="es"} onClick={()=>setLanguage("es")}>ES</button><button aria-pressed={language==="en"} onClick={()=>setLanguage("en")}>EN</button><button onClick={async()=>{await navigator.clipboard.writeText(brief);setCopied(true);setTimeout(()=>setCopied(false),1500)}}>{copied?"Copiado":"Copiar"}</button></div></div>
      <p>{brief}</p>
    </article>

    <p className={styles.disclaimer}><strong>Metodología:</strong> tasas de referencia diarias, no intradía. El escenario no es el P&amp;L de Victorinox: no incorpora COGS real, cobertura, inventario, arancel, mix de ventas ni elasticidad. Los precios competitivos son medianas observadas y no matching SKU a SKU.</p>
  </section>;
}
