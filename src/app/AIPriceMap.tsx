"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./AIPriceMap.module.css";

type Filters={retailerType:"all"|"supermarket"|"department_store"|"pharmacy";supermarket:string;category:string;brand:string;query:string;stock:"all"|"in"|"out";period:number};
type Point={brand:string;brandKey:string;isTarget:boolean;skus:number;retailers:number;coveragePct:number;averagePrice:number;minPrice:number;maxPrice:number;priceIndex:number;inStockPct:number;offers:number;promoPct:number;averageDiscount:number;lastObservedAt?:string|null;sampleProducts?:string[]};
type Analysis={headline:string;summary:string;competitorKeys:string[];insights:Array<{title:string;detail:string}>;actions:string[]};
type PriceMap={targetBrand:string;format?:string|null;formatMatched?:boolean;categories?:string[];points:Point[];kpis:{averagePrice:number;coveragePct:number;promoPct:number;inStockPct:number;nearestCompetitor?:string|null;gapVsNearestPct?:number|null};axis:{x:string;y:string;size:string};generatedAt?:string};
type Message={id:string;role:"user"|"assistant";content:string;analysis?:Analysis;map?:PriceMap|null;ai?:boolean};
type Conversation={id:string;title:string;last_brand?:string|null;updated_at:string};
type ApiResponse={answer?:string;analysis?:Analysis;map?:PriceMap|null;ai?:boolean;error?:string;conversationId?:string;conversationTitle?:string};

const WELCOME:Message={id:"welcome",role:"assistant",content:"Dime qué marca, categoría o formato quieres posicionar. Construiré el mapa con precios reales y seleccionaré los competidores comparables."};
const EXAMPLES=["¿Cómo está posicionada Coca-Cola en formato lata?","Compara Nivea crema con sus competidores","Mapa de OMO líquido en supermercados","¿Cómo está Becker en lata frente a otras cervezas?"];
const id=()=>`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const money=(v?:number)=>Number.isFinite(v)?`$${new Intl.NumberFormat("es-CL",{maximumFractionDigits:0}).format(Number(v))}`:"—";
const pct=(v?:number)=>Number.isFinite(v)?`${Number(v).toLocaleString("es-CL",{maximumFractionDigits:1})}%`:"—";
const historyDate=(v:string)=>{const d=new Date(v),t=new Date();return d.toDateString()===t.toDateString()?new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit"}).format(d):new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"short"}).format(d)};

function BubbleMap({map}:{map:PriceMap}){
  const pts=map.points??[]; if(!pts.length)return null;
  const W=780,H=410,L=70,R=28,T=30,B=58,plotW=W-L-R,plotH=H-T-B;
  const vals=pts.map(p=>Number(p.priceIndex)||100);let min=Math.min(...vals,100),max=Math.max(...vals,100);const span=Math.max(18,max-min);min=Math.max(0,min-span*.12);max=max+span*.12;
  const x=(v:number)=>L+((v-min)/(max-min))*plotW;const y=(v:number)=>T+(1-Math.max(0,Math.min(100,v))/100)*plotH;
  const maxSkus=Math.max(...pts.map(p=>p.skus),1);const radius=(n:number)=>16+Math.sqrt(n/maxSkus)*23;
  const colors=["#0f62fe","#8b5cf6","#0891b2","#d97706","#16a34a","#dc2626","#64748b"];
  const ticks=Array.from({length:5},(_,i)=>min+(max-min)*(i/4));
  return <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mapa de posicionamiento de precios">
      {[0,25,50,75,100].map(v=><g key={v}><line x1={L} y1={y(v)} x2={W-R} y2={y(v)} className={styles.grid}/><text x={L-12} y={y(v)+4} textAnchor="end" className={styles.axisText}>{v}%</text></g>)}
      {ticks.map((v,i)=><g key={i}><line x1={x(v)} y1={T} x2={x(v)} y2={H-B} className={styles.vgrid}/><text x={x(v)} y={H-B+25} textAnchor="middle" className={styles.axisText}>{Math.round(v)}</text></g>)}
      {100>=min&&100<=max&&<><line x1={x(100)} y1={T} x2={x(100)} y2={H-B} className={styles.parity}/><text x={x(100)+6} y={T+12} className={styles.parityText}>PARIDAD 100</text></>}
      <text x={L+plotW/2} y={H-8} textAnchor="middle" className={styles.axisLabel}>Índice de precio vs {map.targetBrand}</text>
      <text transform={`translate(17 ${T+plotH/2}) rotate(-90)`} textAnchor="middle" className={styles.axisLabel}>Cobertura en cadenas</text>
      {pts.map((p,i)=>{const cx=x(p.priceIndex),cy=y(p.coveragePct),r=radius(p.skus);const fill=p.isTarget?"#0b57d0":colors[(i-1+colors.length)%colors.length];return <g key={p.brandKey} className={styles.bubble}>
        {p.isTarget&&<circle cx={cx} cy={cy} r={r+5} fill="none" stroke="#0b57d0" strokeWidth="2" opacity=".25"/>}
        <circle cx={cx} cy={cy} r={r} fill={fill} opacity={p.isTarget?.95:.78}/>
        <text x={cx} y={cy-2} textAnchor="middle" className={styles.bubbleBrand}>{p.brand.length>15?`${p.brand.slice(0,13)}…`:p.brand}</text>
        <text x={cx} y={cy+13} textAnchor="middle" className={styles.bubbleValue}>{Math.round(p.priceIndex)}</text>
        <title>{`${p.brand} · ${money(p.averagePrice)} · índice ${p.priceIndex} · cobertura ${p.coveragePct}% · ${p.skus} SKU`}</title>
      </g>})}
    </svg>
    <div className={styles.chartLegend}><span><i className={styles.targetDot}/>Marca objetivo</span><span>Burbuja = profundidad de surtido</span><span>Arriba = mayor cobertura</span><span>Derecha = mayor precio relativo</span></div>
  </div>;
}

function MapPanel({map,analysis,loading}:{map:PriceMap|null;analysis?:Analysis;loading:boolean}){
  if(loading&&!map)return <div className={styles.emptyMap}><div className={styles.loader}/><h3>Construyendo mapa competitivo…</h3><p>La IA está identificando comparables y cruzando precios, stock, promociones y cobertura.</p></div>;
  if(!map)return <div className={styles.emptyMap}><div className={styles.mapIcon}>◎</div><h3>Tu mapa aparecerá aquí</h3><p>Pregunta por una marca y formato. La IA seleccionará competidores desde la base y dibujará el posicionamiento automáticamente.</p><div className={styles.emptyAxes}><span>↑ cobertura</span><b>●</b><span>precio relativo →</span></div></div>;
  const k=map.kpis;return <div className={styles.mapContent}>
    <div className={styles.mapHead}><div><span>AI PRICE MAP</span><h2>{analysis?.headline||`${map.targetBrand} · mapa competitivo`}</h2><p>{analysis?.summary||"Posicionamiento construido con datos actuales de la plataforma."}</p></div><div className={styles.contextPill}>{map.format?`Formato: ${map.format}`:"Formato general"}</div></div>
    <div className={styles.kpis}>
      <div><span>Precio equivalente</span><strong>{money(k.averagePrice)}</strong><small>marca objetivo</small></div>
      <div><span>Cobertura</span><strong>{pct(k.coveragePct)}</strong><small>cadenas comparables</small></div>
      <div><span>Promoción</span><strong>{pct(k.promoPct)}</strong><small>SKU con oferta</small></div>
      <div><span>Competidor cercano</span><strong className={styles.smallStrong}>{k.nearestCompetitor||"—"}</strong><small>{k.gapVsNearestPct==null?"sin brecha":`${Math.abs(k.gapVsNearestPct).toFixed(1)}% de brecha`}</small></div>
    </div>
    <BubbleMap map={map}/>
    <div className={styles.tableBlock}><div className={styles.tableTitle}><strong>Detalle competitivo</strong><span>Precio equivalente normaliza packs cuando es posible</span></div><div className={styles.tableScroll}><table><thead><tr><th>Marca</th><th>Precio prom.</th><th>Índice</th><th>Cobertura</th><th>Stock</th><th>Promos</th><th>SKU</th></tr></thead><tbody>{map.points.map(p=><tr key={p.brandKey} className={p.isTarget?styles.targetRow:""}><td><b>{p.brand}</b>{p.isTarget&&<em>Objetivo</em>}</td><td>{money(p.averagePrice)}</td><td>{p.priceIndex.toFixed(1)}</td><td>{pct(p.coveragePct)}</td><td>{pct(p.inStockPct)}</td><td>{pct(p.promoPct)}</td><td>{p.skus}</td></tr>)}</tbody></table></div></div>
  </div>;
}

export default function AIPriceMap({filters}:{filters:Filters}){
  const [messages,setMessages]=useState<Message[]>([WELCOME]);const [input,setInput]=useState("");const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const [map,setMap]=useState<PriceMap|null>(null);const [analysis,setAnalysis]=useState<Analysis|undefined>();const [conversationId,setConversationId]=useState("");const [conversations,setConversations]=useState<Conversation[]>([]);const [historyOpen,setHistoryOpen]=useState(false);const inputRef=useRef<HTMLTextAreaElement|null>(null);
  const scope=useMemo(()=>[filters.retailerType!=="all"?(filters.retailerType==="supermarket"?"Supermercados":filters.retailerType==="pharmacy"?"Farmacias":"Multitiendas"):"Todas las cadenas",filters.supermarket,filters.category,filters.stock!=="all"?(filters.stock==="in"?"Con stock":"Sin stock"):""].filter(Boolean).join(" · "),[filters]);

  async function refreshHistory(){try{const r=await fetch("/api/price-map-ai/history",{cache:"no-store"});const d=await r.json();if(r.ok)setConversations(Array.isArray(d.conversations)?d.conversations:[]);}catch{}}
  useEffect(()=>{void refreshHistory()},[]);
  function newChat(){setConversationId("");setMessages([WELCOME]);setMap(null);setAnalysis(undefined);setError("");setHistoryOpen(false);setTimeout(()=>inputRef.current?.focus(),40)}
  async function openConversation(idValue:string){setLoading(true);setError("");try{const r=await fetch(`/api/price-map-ai/history?id=${encodeURIComponent(idValue)}`,{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"No se pudo abrir el chat");const stored=(Array.isArray(d.messages)?d.messages:[]).map((m:any)=>({id:String(m.id),role:m.role,content:m.content,analysis:m.payload?.analysis??undefined,map:m.payload?.map??null,ai:m.ai} as Message));setMessages([WELCOME,...stored]);setConversationId(idValue);const last=[...stored].reverse().find((m:Message)=>m.role==="assistant"&&m.map);setMap(last?.map??null);setAnalysis(last?.analysis);setHistoryOpen(false);}catch(e){setError(e instanceof Error?e.message:"No se pudo abrir el chat")}finally{setLoading(false)}}
  async function deleteConversation(e:React.MouseEvent,idValue:string){e.stopPropagation();if(!confirm("¿Eliminar esta conversación?"))return;await fetch(`/api/price-map-ai/history?id=${encodeURIComponent(idValue)}`,{method:"DELETE"});if(conversationId===idValue)newChat();void refreshHistory()}

  async function ask(q:string){const clean=q.trim();if(!clean||loading)return;const user:Message={id:id(),role:"user",content:clean};const next=[...messages,user];setMessages(next);setInput("");setLoading(true);setError("");try{const r=await fetch("/api/price-map-ai",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages:next.filter(m=>m.id!=="welcome").map(({role,content})=>({role,content})),filters,conversationId:conversationId||undefined})});const d=await r.json() as ApiResponse;if(!r.ok||!d.answer)throw new Error(d.error||"No fue posible construir el mapa");const assistant:Message={id:id(),role:"assistant",content:d.answer,analysis:d.analysis,map:d.map,ai:d.ai};setMessages(cur=>[...cur,assistant]);if(d.map)setMap(d.map);setAnalysis(d.analysis);if(d.conversationId)setConversationId(d.conversationId);void refreshHistory();}catch(e){setError(e instanceof Error?e.message:"No fue posible construir el mapa")}finally{setLoading(false);setTimeout(()=>inputRef.current?.focus(),40)}}
  function submit(e:FormEvent){e.preventDefault();void ask(input)}

  return <div className={styles.shell}>
    <div className={styles.topbar}><div><span>MGP · OPENAI</span><h2>AI Price Map</h2><p>Conversa con tus datos y convierte cada pregunta en un mapa competitivo accionable.</p></div><div className={styles.scope}><small>ALCANCE</small><strong>{scope}</strong></div></div>
    <div className={styles.workspace}>
      <aside className={styles.chatPanel}>
        <div className={styles.chatToolbar}><button className={styles.newButton} onClick={newChat}>＋ Nuevo análisis</button><button className={styles.historyButton} onClick={()=>setHistoryOpen(v=>!v)}>☰ Historial {conversations.length?`(${conversations.length})`:""}</button></div>
        {historyOpen&&<div className={styles.history}><div className={styles.historyHead}><b>Conversaciones</b><button onClick={()=>setHistoryOpen(false)}>×</button></div>{conversations.length===0?<p>Aún no hay análisis guardados.</p>:conversations.map(c=><button key={c.id} className={`${styles.historyItem} ${c.id===conversationId?styles.activeHistory:""}`} onClick={()=>void openConversation(c.id)}><span><strong>{c.title}</strong><small>{c.last_brand||"AI Price Map"} · {historyDate(c.updated_at)}</small></span><i onClick={e=>void deleteConversation(e,c.id)}>×</i></button>)}</div>}
        <div className={styles.messages}>{messages.map(m=><div key={m.id} className={`${styles.message} ${m.role==="user"?styles.user:styles.assistant}`}><div className={styles.avatar}>{m.role==="assistant"?"AI":"TÚ"}</div><div className={styles.bubble}>{m.analysis?<><strong className={styles.answerHeadline}>{m.analysis.headline}</strong><p>{m.analysis.summary}</p><div className={styles.miniInsights}>{m.analysis.insights.slice(0,3).map((x,i)=><div key={i}><b>{x.title}</b><span>{x.detail}</span></div>)}</div></>:<p>{m.content}</p>}</div></div>)}{loading&&<div className={`${styles.message} ${styles.assistant}`}><div className={styles.avatar}>AI</div><div className={`${styles.bubble} ${styles.thinking}`}><i/><i/><i/><span>Analizando comparables…</span></div></div>}</div>
        {messages.length===1&&<div className={styles.examples}><span>PRUEBA PREGUNTANDO</span>{EXAMPLES.map(x=><button key={x} onClick={()=>void ask(x)}>{x}</button>)}</div>}
        {error&&<div className={styles.error}>{error}<button onClick={()=>setError("")}>×</button></div>}
        <form className={styles.composer} onSubmit={submit}><textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(input.trim())void ask(input)}}} placeholder="Ej: ¿Cómo está Coca-Cola en lata frente a sus competidores?" rows={3}/><button disabled={loading||!input.trim()}>↑</button></form>
        <div className={styles.disclaimer}>La IA selecciona comparables; los números del mapa provienen de la base monitoreada.</div>
      </aside>
      <main className={styles.mapPanel}><MapPanel map={map} analysis={analysis} loading={loading}/></main>
    </div>
  </div>;
}
