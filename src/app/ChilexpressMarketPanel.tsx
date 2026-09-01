"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./ChilexpressMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

type ApiRow = {
  serviceType?: string;
  weightBand?: string;
  distanceBand?: string;
  providerGroup?: string;
  medianShipmentPrice?: number | string | null;
  latestDate?: string | null;
  originLabel?: string | null;
  destinationLabel?: string | null;
  sourceKinds?: string[];
};

type Payload = {
  normalized?: { rows?: ApiRow[]; summary?: Record<string, unknown> };
  error?: string;
};

type RouteRow = {
  destination: string;
  weightBand: string;
  distanceBand: string;
  serviceType: string;
  chilexpress: number;
  competitor: number;
  competitorName: string;
  index: number;
  gap: number;
  latestDate: string;
  source: string;
};

type Message = { role: "user" | "assistant"; content: string };
type Tab = "overview" | "copilot" | "benchmark" | "heatmap" | "opportunities" | "history" | "sources";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const NF = new Intl.NumberFormat("es-CL");

const FALLBACK: RouteRow[] = [
  ["Santiago Centro","0–0,5 kg","Sin distancia","Domicilio estándar / express",5975,3100,"Blue Express","2026-08-24"],
  ["Rancagua","0–0,5 kg","50–200 km","Domicilio estándar / express",11172,4000,"Blue Express","2026-08-24"],
  ["Valparaíso","0–0,5 kg","50–200 km","Domicilio estándar / express",10494,3900,"Blue Express","2026-08-24"],
  ["Talca","0–0,5 kg","200–500 km","Domicilio estándar / express",11812,4200,"Blue Express","2026-08-24"],
  ["Chillán","0–0,5 kg","200–500 km","Domicilio estándar / express",10768,4600,"Blue Express","2026-08-24"],
  ["Concepción","0–0,5 kg","200–500 km","Domicilio estándar / express",10768,4700,"Blue Express","2026-08-24"],
  ["La Serena","0–0,5 kg","200–500 km","Domicilio estándar / express",12092,4600,"Blue Express","2026-08-24"],
  ["Copiapó","0–0,5 kg","500–1.000 km","Domicilio estándar / express",12092,4850,"Blue Express","2026-08-24"],
  ["Temuco","0–0,5 kg","500–1.000 km","Domicilio estándar / express",11812,4950,"Blue Express","2026-08-24"],
  ["Valdivia","0–0,5 kg","500–1.000 km","Domicilio estándar / express",11812,5300,"Blue Express","2026-08-24"],
  ["Puerto Montt","0–0,5 kg","500–1.000 km","Domicilio estándar / express",13652,5300,"Blue Express","2026-08-24"],
  ["Antofagasta","0–0,5 kg","1.000+ km","Domicilio estándar / express",31144,6300,"Blue Express","2026-08-24"],
  ["Iquique","0–0,5 kg","1.000+ km","Domicilio estándar / express",35798,6550,"Blue Express","2026-08-24"],
  ["Arica","0–0,5 kg","1.000+ km","Domicilio estándar / express",35798,7150,"Blue Express","2026-08-24"],
].map(([destination, weightBand, distanceBand, serviceType, chilexpress, competitor, competitorName, latestDate]) => {
  const own = Number(chilexpress);
  const comp = Number(competitor);
  return {
    destination: String(destination),
    weightBand: String(weightBand),
    distanceBand: String(distanceBand),
    serviceType: String(serviceType),
    chilexpress: own,
    competitor: comp,
    competitorName: String(competitorName),
    index: Math.round((own / comp) * 1000) / 10,
    gap: own - comp,
    latestDate: String(latestDate),
    source: "Tarifa pública observada",
  };
});

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]) {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort((a,b)=>a-b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

function normalizeLive(rows: ApiRow[]): RouteRow[] {
  const exact = rows.filter(row => row.providerGroup && row.destinationLabel && num(row.medianShipmentPrice) > 0);
  const groups = new Map<string, ApiRow[]>();
  for (const row of exact) {
    const key = [row.originLabel || "Santiago Centro", row.destinationLabel, row.weightBand || "", row.serviceType || ""].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const out: RouteRow[] = [];
  for (const group of groups.values()) {
    const own = group.find(row => row.providerGroup?.toLowerCase() === "chilexpress");
    const competitors = group.filter(row => row.providerGroup?.toLowerCase() !== "chilexpress" && num(row.medianShipmentPrice) > 0);
    if (!own || !competitors.length) continue;
    const ownPrice = num(own.medianShipmentPrice);
    const compPrice = median(competitors.map(row => num(row.medianShipmentPrice)));
    out.push({
      destination: own.destinationLabel || "—",
      weightBand: own.weightBand || "—",
      distanceBand: own.distanceBand || "—",
      serviceType: own.serviceType || "Courier",
      chilexpress: ownPrice,
      competitor: compPrice,
      competitorName: [...new Set(competitors.map(row => row.providerGroup || "Mercado"))].join(" / "),
      index: Math.round((ownPrice / compPrice) * 1000) / 10,
      gap: ownPrice - compPrice,
      latestDate: own.latestDate || competitors[0]?.latestDate || "2026-08-24",
      source: own.sourceKinds?.join(", ") || "Tarifa pública observada",
    });
  }
  return out.sort((a,b)=>b.index-a.index);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value + "T12:00:00");
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"short",year:"numeric"}).format(d);
}

function indexClass(value: number) {
  if (value >= 180) return styles.indexHigh;
  if (value >= 130) return styles.indexPremium;
  if (value < 95) return styles.indexValue;
  return styles.indexParity;
}

function action(value: number) {
  if (value >= 180) return "Revisión urgente";
  if (value >= 130) return "Premium alto";
  if (value >= 105) return "Premium moderado";
  if (value < 95) return "Espacio potencial";
  return "Paridad";
}

function localAnswer(question: string, rows: RouteRow[]) {
  const sorted = [...rows].sort((a,b)=>b.index-a.index);
  const avg = rows.length ? rows.reduce((sum,row)=>sum+row.index,0)/rows.length : 0;
  const max = sorted[0];
  const min = [...rows].sort((a,b)=>a.index-b.index)[0];
  const q = question.toLocaleLowerCase("es-CL");
  if (q.includes("blue")) return `Conclusión: Chilexpress mantiene un premium relevante frente a Blue Express en la muestra actual.\n\n• Índice promedio: ${avg.toFixed(0)}.\n• Menor brecha: ${min?.destination || "—"} (índice ${min?.index.toFixed(0) || "—"}).\n• Mayor brecha: ${max?.destination || "—"} (índice ${max?.index.toFixed(0) || "—"}).\n\nAntes de actuar, conviene validar SLA, cobertura, seguro, velocidad y condiciones comerciales.`;
  if (q.includes("subir") || q.includes("aumentar")) {
    const candidates = rows.filter(row => row.index < 95);
    return candidates.length ? `Hay ${candidates.length} rutas con índice bajo 95 donde podría existir espacio para aumentar tarifa.` : "No aparecen rutas bajo índice 95 en la cobertura comparable actual. La prioridad es explicar y gestionar los premiums existentes.";
  }
  return `Conclusión: la muestra tiene ${rows.length} rutas comparables y un índice promedio de ${avg.toFixed(0)}. La principal alerta está en ${max?.destination || "—"}, con índice ${max?.index.toFixed(0) || "—"} y gap de ${max ? CLP.format(max.gap) : "—"} por envío.`;
}

export default function ChilexpressMarketPanel() {
  const [rows,setRows] = useState<RouteRow[]>(FALLBACK);
  const [tab,setTab] = useState<Tab>("overview");
  const [loading,setLoading] = useState(true);
  const [sourceMode,setSourceMode] = useState<"live"|"snapshot">("snapshot");
  const [query,setQuery] = useState("");
  const [distance,setDistance] = useState("");
  const [messages,setMessages] = useState<Message[]>([{role:"assistant",content:"Soy el Pricing Copilot de Chilexpress. Puedo analizar brechas por ruta, premiums y prioridades de pricing usando la cobertura disponible."}]);
  const [chatInput,setChatInput] = useState("");
  const [chatLoading,setChatLoading] = useState(false);

  useEffect(()=>{
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/b2b-pricing?category=courier&days=1095&layer=best",{cache:"no-store"});
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar datos.");
        const live = normalizeLive(payload.normalized?.rows ?? []);
        if (active && live.length >= 4) {
          setRows(live);
          setSourceMode("live");
        }
      } catch {
        if (active) {
          setRows(FALLBACK);
          setSourceMode("snapshot");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    trackUsageEvent("module_view",{module:"chilexpress-pricing"});
    return ()=>{active=false;};
  },[]);

  const stats = useMemo(()=>{
    const avg = rows.length ? rows.reduce((sum,row)=>sum+row.index,0)/rows.length : 0;
    return {
      avg,
      risk: rows.filter(row=>row.index>=130).length,
      upside: rows.filter(row=>row.index<95).length,
      competitors: new Set(rows.map(row=>row.competitorName)).size,
      latest: [...rows].map(row=>row.latestDate).sort().at(-1) || "2026-08-24",
    };
  },[rows]);

  const filtered = useMemo(()=>rows.filter(row=>{
    if (distance && row.distanceBand !== distance) return false;
    const q = query.trim().toLocaleLowerCase("es-CL");
    return !q || `${row.destination} ${row.competitorName} ${row.serviceType}`.toLocaleLowerCase("es-CL").includes(q);
  }),[rows,distance,query]);

  const bands = useMemo(()=>[...new Set(rows.map(row=>row.distanceBand))],[rows]);
  const bandCards = useMemo(()=>bands.map(band=>{
    const subset = rows.filter(row=>row.distanceBand===band);
    const avg = subset.reduce((sum,row)=>sum+row.index,0)/Math.max(1,subset.length);
    return {band,avg,count:subset.length,min:Math.min(...subset.map(row=>row.index)),max:Math.max(...subset.map(row=>row.index))};
  }),[rows,bands]);

  async function ask(question: string) {
    const clean = question.trim();
    if (!clean || chatLoading) return;
    const next = [...messages,{role:"user" as const,content:clean}].slice(-10);
    setMessages(next); setChatInput(""); setChatLoading(true);
    try {
      const response = await fetch("/api/chilexpress-pricing-chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages:next,routes:rows}),cache:"no-store"});
      const payload = await response.json() as {answer?:string};
      const answer = response.ok && payload.answer ? payload.answer : localAnswer(clean,rows);
      setMessages(current=>[...current,{role:"assistant" as const,content:answer}].slice(-12));
    } catch {
      setMessages(current=>[...current,{role:"assistant" as const,content:localAnswer(clean,rows)}].slice(-12));
    } finally { setChatLoading(false); }
  }

  function submitChat(event: FormEvent) {
    event.preventDefault();
    void ask(chatInput);
  }

  function go(next: Tab) {
    setTab(next);
    trackUsageEvent("tab_view",{module:"chilexpress-pricing",metadata:{tab:next}});
  }

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span>CHILEXPRESS · LOGISTICS PRICING INTELLIGENCE</span>
        <h1>Benchmark competitivo de paquetería</h1>
        <p>Comparación normalizada por <strong>ruta, peso y servicio</strong>, con Price Index, brechas tarifarias, oportunidades y Copilot de pricing.</p>
      </div>
      <div className={styles.liveBox}>
        <span><i/> {sourceMode === "live" ? "DATA LIVE" : "SNAPSHOT VALIDADO"}</span>
        <strong>{rows.length} rutas comparables · {stats.competitors} benchmark</strong>
        <small>{loading ? "Actualizando datos…" : `Última observación ${dateLabel(stats.latest)}`}</small>
      </div>
    </header>

    <div className={styles.kpis}>
      <article><span>Rutas comparables</span><strong>{NF.format(rows.length)}</strong><small>Santiago → destinos nacionales</small></article>
      <article><span>Price Index promedio</span><strong>{stats.avg.toFixed(0)}</strong><small>benchmark = 100</small></article>
      <article><span>Premiums altos</span><strong>{stats.risk}</strong><small>índice ≥ 130</small></article>
      <article><span>Espacios potenciales</span><strong>{stats.upside}</strong><small>índice &lt; 95</small></article>
      <article><span>Último corte</span><strong>{dateLabel(stats.latest)}</strong><small>evidencia comparable</small></article>
    </div>

    <nav className={styles.tabs}>
      {([["overview","Resumen"],["copilot","AI Copilot"],["benchmark","Benchmark"],["heatmap","Price Index Map"],["opportunities","Oportunidades"],["history","Histórico"],["sources","Fuentes"]] as [Tab,string][]).map(([key,label])=>
        <button key={key} className={tab===key?styles.active:""} onClick={()=>go(key)}>{label}</button>
      )}
    </nav>

    {tab==="overview"&&<>
      <section className={styles.positionGrid}>
        {bandCards.map(card=><article className={styles.positionCard} key={card.band}>
          <span>{card.band.toUpperCase()}</span>
          <h2>{card.avg.toFixed(0)}</h2>
          <p>Price Index promedio</p>
          <div><small>Rutas</small><strong>{card.count}</strong></div>
          <em className={indexClass(card.avg)}>{action(card.avg)}</em>
          <footer>Rango {card.min.toFixed(0)}–{card.max.toFixed(0)}</footer>
        </article>)}
      </section>
      <section className={styles.grid2}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>TOP ALERTS</span><h2>Rutas a revisar primero</h2><p>Priorizadas por mayor Price Index.</p></div></div>
          <div className={styles.alerts}>{rows.slice().sort((a,b)=>b.index-a.index).slice(0,6).map((row,index)=><div key={row.destination}><b>{String(index+1).padStart(2,"0")}</b><div><strong>Santiago → {row.destination}</strong><small>{row.weightBand} · {row.distanceBand}</small></div><em className={indexClass(row.index)}>{row.index.toFixed(0)}</em></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><span>LECTURA EJECUTIVA</span><h2>Qué está diciendo el mercado</h2></div></div>
          <div className={styles.insights}>
            <div><b>01</b><p>Chilexpress presenta un premium visible frente al benchmark público comparable en la muestra actual.</p></div>
            <div><b>02</b><p>Las mayores brechas se concentran en rutas de larga distancia; conviene separar precio puro de atributos de SLA, seguro y cobertura.</p></div>
            <div><b>03</b><p>No aparecen rutas claramente sub-indexadas en esta muestra, por lo que la prioridad es gestionar premiums antes de buscar alzas.</p></div>
          </div>
        </article>
      </section>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><span>MATRIZ RÁPIDA</span><h2>Chilexpress vs benchmark</h2><p>Primeras rutas ordenadas por criticidad.</p></div><button className={styles.secondaryButton} onClick={()=>go("benchmark")}>Ver matriz completa →</button></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ruta</th><th>Chilexpress</th><th>Benchmark</th><th>Gap</th><th>Index</th><th>Acción</th></tr></thead><tbody>
          {rows.slice().sort((a,b)=>b.index-a.index).slice(0,8).map(row=><tr key={row.destination}><td><strong>Santiago → {row.destination}</strong><small>{row.distanceBand}</small></td><td>{CLP.format(row.chilexpress)}</td><td>{CLP.format(row.competitor)}<small>{row.competitorName}</small></td><td>{CLP.format(row.gap)}</td><td><em className={indexClass(row.index)}>{row.index.toFixed(0)}</em></td><td>{action(row.index)}</td></tr>)}
        </tbody></table></div>
      </article>
    </>}

    {tab==="benchmark"&&<article className={styles.panel}>
      <div className={styles.panelTitle}><div><span>BENCHMARK COMPETITIVO</span><h2>Matriz homologada por ruta</h2><p>Precio observable para el mismo perfil de envío.</p></div></div>
      <div className={styles.filters}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar destino o competidor…" /><select value={distance} onChange={e=>setDistance(e.target.value)}><option value="">Todas las distancias</option>{bands.map(x=><option key={x}>{x}</option>)}</select><div><span>Peso</span><strong>0–0,5 kg</strong></div><div><span>Origen</span><strong>Santiago Centro</strong></div></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ruta</th><th>Peso</th><th>Chilexpress</th><th>Benchmark</th><th>Gap</th><th>Price Index</th><th>Acción</th></tr></thead><tbody>
        {filtered.map(row=><tr key={row.destination}><td><strong>Santiago → {row.destination}</strong><small>{row.serviceType}</small></td><td>{row.weightBand}</td><td>{CLP.format(row.chilexpress)}</td><td>{CLP.format(row.competitor)}<small>{row.competitorName}</small></td><td>{CLP.format(row.gap)}</td><td><em className={indexClass(row.index)}>{row.index.toFixed(0)}</em></td><td>{action(row.index)}</td></tr>)}
      </tbody></table></div>
    </article>}

    {tab==="heatmap"&&<article className={styles.panel}>
      <div className={styles.panelTitle}><div><span>PRICE INDEX MAP</span><h2>Mapa de brechas por corredor</h2><p>Mercado = 100. Mientras mayor el índice, mayor el premium observable.</p></div></div>
      <div className={styles.legend}><span><i className={styles.good}/> &lt;95 Espacio</span><span><i className={styles.parity}/> 95–104 Paridad</span><span><i className={styles.warn}/> 105–129 Premium</span><span><i className={styles.hot}/> 130+ Alto</span></div>
      <div className={styles.heatGrid}>{rows.slice().sort((a,b)=>a.index-b.index).map(row=><article key={row.destination} className={row.index>=180?styles.heatHot:row.index>=130?styles.heatWarn:row.index<95?styles.heatGood:styles.heatParity}><span>{row.destination}</span><strong>{row.index.toFixed(0)}</strong><small>{CLP.format(row.chilexpress)} vs {CLP.format(row.competitor)}</small></article>)}</div>
    </article>}

    {tab==="opportunities"&&<>
      <div className={styles.opportunityGrid}>
        <article><span>RIESGO COMPETITIVO</span><strong>{stats.risk}</strong><p>Rutas con índice ≥130. Validar premium, atributos y conversión.</p></article>
        <article><span>ESPACIO DE ALZA</span><strong>{stats.upside}</strong><p>Rutas bajo índice 95. La muestra actual no muestra espacios evidentes.</p></article>
        <article><span>MAYOR GAP</span><strong>{CLP.format(Math.max(...rows.map(row=>row.gap)))}</strong><p>Diferencia máxima observable por envío comparable.</p></article>
      </div>
      <article className={styles.panel}><div className={styles.panelTitle}><div><span>ACTION QUEUE</span><h2>Cola priorizada de revisión</h2></div></div><div className={styles.actionList}>{rows.slice().sort((a,b)=>b.index-a.index).map(row=><div key={row.destination}><em className={indexClass(row.index)}>{row.index.toFixed(0)}</em><div><strong>Santiago → {row.destination}</strong><small>{row.distanceBand} · gap {CLP.format(row.gap)}</small></div><b>{action(row.index)}</b><button onClick={()=>{go("copilot");void ask(`Analiza la ruta Santiago a ${row.destination} y dime qué revisar.`);}}>Analizar ✦</button></div>)}</div></article>
    </>}

    {tab==="history"&&<article className={styles.panel}>
      <div className={styles.panelTitle}><div><span>HISTÓRICO Y EVIDENCIA</span><h2>Timeline de capturas validadas</h2><p>La plataforma no interpola datos inexistentes.</p></div></div>
      <div className={styles.historyGrid}>
        <article><span>24 AGO 2026</span><h3>Tarifas públicas comparables</h3><p>Chilexpress y Blue Express · Santiago → principales destinos · hasta 0,5 kg.</p></article>
        <article><span>26 DIC 2025</span><h3>Evidencia B2B pública</h3><p>CorreosChile · tarifario regional observado en Mercado Público. Se mantiene separado del benchmark comercial.</p></article>
        <article><span>PRÓXIMOS CORTES</span><h3>Serie automática</h3><p>Cada nueva captura irá construyendo la evolución por ruta, peso, proveedor e índice competitivo.</p></article>
      </div>
    </article>}

    {tab==="sources"&&<section className={styles.grid2}>
      <article className={styles.panel}><div className={styles.panelTitle}><div><span>CAPA COMERCIAL</span><h2>Tarifas públicas</h2></div></div><div className={styles.sourceCards}><div><strong>Chilexpress</strong><span>Tarifa pública observada</span><small>Rutas nacionales desde Santiago</small></div><div><strong>Blue Express</strong><span>Tarifa pública observada</span><small>Benchmark comparable</small></div></div></article>
      <article className={styles.panel}><div className={styles.panelTitle}><div><span>CAPA B2B</span><h2>Evidencia pública empresarial</h2></div></div><div className={styles.sourceCards}><div><strong>CorreosChile</strong><span>Mercado Público / tarifario regional</span><small>Se analiza como capa B2B separada</small></div></div><div className={styles.note}>No se mezcla automáticamente una tarifa B2B adjudicada con una tarifa comercial pública. La homologación exige contexto de servicio, volumen y condiciones.</div></article>
    </section>}

    {tab==="copilot"&&<section className={styles.copilot}>
      <div className={styles.copilotHead}><div><span>AI COPILOT</span><h2>Analista conversacional de pricing</h2><p>Responde usando exclusivamente la matriz visible en esta cuenta.</p></div><strong>● Online</strong></div>
      <div className={styles.copilotGrid}>
        <aside><span>PREGUNTAS SUGERIDAS</span>{["¿Dónde somos más caros que el mercado?","Compara Chilexpress vs Blue Express","¿Dónde podríamos subir precios?","¿Cuál es el principal riesgo competitivo?"].map(q=><button key={q} onClick={()=>void ask(q)} disabled={chatLoading}>{q}<b>↗</b></button>)}</aside>
        <div className={styles.chat}>
          <div className={styles.messages}>{messages.map((message,index)=><div key={index} className={message.role==="user"?styles.userMsg:styles.aiMsg}><span>{message.role==="user"?"TÚ":"MGP"}</span><p>{message.content}</p></div>)}{chatLoading&&<div className={styles.aiMsg}><span>MGP</span><p>Analizando matriz competitiva…</p></div>}</div>
          <form onSubmit={submitChat}><textarea value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Pregunta por rutas, gaps, premiums o acciones…" /><button disabled={!chatInput.trim()||chatLoading}>{chatLoading?"…":"Enviar"}</button></form>
        </div>
      </div>
    </section>}

    <footer className={styles.footer}>MGP Price Intelligence · Chilexpress · Logistics Pricing Intelligence</footer>
  </section>;
}
