"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./BodegasDonLuisPanel.module.css";

type BdlPayload = {
  currency?: string;
  brand: { name: string; slug: string; countryCode: string };
  summary: { products: number; sources: number; listings: number; lastObservedAt: string | null };
  sources: Array<{ id: string; retailer_name: string; domain: string; last_status: string | null; last_crawled_at: string | null; listings: number }>;
  live?: { observedAt?: string; history?: { days: number; categories: string[] } } | null;
};

type MatrixCell = {
  retailer: string;
  domain: string;
  category: "Pisco" | "Ron" | "Vino";
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  skuCount: number;
  promoCount: number;
  avgDiscountPct: number | null;
  observedAt: string;
};

type MatrixData = {
  currency: "PEN";
  categories: Array<"Pisco" | "Ron" | "Vino">;
  retailers: Array<{ name: string; domain: string; skuCount: number; observedAt: string }>;
  cells: MatrixCell[];
  lastObservedAt: string | null;
  totalSkuObservations: number;
};

type TrendPoint = {
  at: string;
  capturedAt: string;
  retailer: string;
  category: "Pisco" | "Ron" | "Vino";
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  skuCount: number;
};

type TrendData = {
  days: number;
  bucketHours: number;
  categories: Array<"Pisco" | "Ron" | "Vino">;
  chains: string[];
  points: TrendPoint[];
  lastCapturedAt: string | null;
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };

const CATEGORIES = ["Pisco", "Ron", "Vino"] as const;
const TREND_CATEGORIES = ["Ron", "Vino", "Pisco"] as const;
const CHAIN_COLORS: Record<string, string> = {
  "Metro Perú": "#38bdf8",
  "Plaza Vea / Makro": "#f59e0b",
  "Tottus Perú": "#34d399",
  "Vivanda": "#a78bfa",
  "Wong": "#fb7185",
};
type Tab = "overview" | "chains" | "downloads" | "chat";

function pen(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

function number(value: number | null | undefined) {
  return new Intl.NumberFormat("es-PE").format(Number(value || 0));
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function captureLabel(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Lima",
  }).format(new Date(value));
}

function chatInline(value: string) {
  return value.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function chatTableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function chatIsTableDivider(line: string) {
  const cells = chatTableCells(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function ChatMarkdown({ text }: { text: string }) {
  const lines = String(text || "").replace(/\r\n/g, "\n").trim().split("\n");
  const blocks = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = (lines[index] || "").trim();
    if (!line) { index += 1; continue; }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={"h-" + key++}>{chatInline(heading[2])}</h4>);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && chatIsTableDivider(lines[index + 1] || "")) {
      const headers = chatTableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] || "").includes("|")) {
        rows.push(chatTableCells(lines[index]));
        index += 1;
      }
      blocks.push(<div className={styles.chatTableWrap} key={"table-" + key++}><table className={styles.chatTable}>
        <thead><tr>{headers.map((header, cellIndex) => <th key={cellIndex}>{chatInline(header)}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{chatInline(row[cellIndex] || "")}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test((lines[index] || "").trim())) {
        items.push((lines[index] || "").trim().replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={"ul-" + key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{chatInline(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test((lines[index] || "").trim())) {
        items.push((lines[index] || "").trim().replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={"ol-" + key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{chatInline(item)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] || "").trim() &&
      !/^#{1,4}\s+/.test((lines[index] || "").trim()) &&
      !/^[-*+]\s+/.test((lines[index] || "").trim()) &&
      !/^\d+[.)]\s+/.test((lines[index] || "").trim()) &&
      !((lines[index] || "").includes("|") && index + 1 < lines.length && chatIsTableDivider(lines[index + 1] || ""))
    ) {
      paragraph.push((lines[index] || "").trim());
      index += 1;
    }
    blocks.push(<p key={"p-" + key++}>{paragraph.map((item, itemIndex) => <Fragment key={itemIndex}>{itemIndex > 0 && <br/>}{chatInline(item)}</Fragment>)}</p>);
  }

  return <div className={styles.chatMarkdown}>{blocks}</div>;
}

function PriceTrendChart({ category, data }: { category: "Pisco" | "Ron" | "Vino"; data: TrendData | null }) {
  const points = (data?.points || []).filter(point => point.category === category);
  const chains = (data?.chains || []).filter(chain => points.some(point => point.retailer === chain));
  const times = [...new Set(points.map(point => point.at))].sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
  const values = points.map(point => Number(point.avgPrice)).filter(value => Number.isFinite(value));

  const width = 720;
  const height = 255;
  const left = 54;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  if (!values.length) {
    return <article className={styles.trendCard}>
      <div className={styles.trendTitle}><div><span>EVOLUCIÓN</span><h3>{category}</h3></div><small>Sin tomas todavía</small></div>
      <div className={styles.trendEmpty}>El gráfico se llenará automáticamente con las próximas capturas de precio.</div>
    </article>;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, rawMax * 0.08, 2);
  const min = Math.max(0, rawMin - spread * 0.14);
  const max = rawMax + spread * 0.14;
  const y = (value: number) => top + ((max - value) / Math.max(0.0001, max - min)) * plotHeight;
  const x = (at: string) => {
    const index = times.indexOf(at);
    if (times.length <= 1) return left + plotWidth / 2;
    return left + (index / (times.length - 1)) * plotWidth;
  };

  const yTicks = Array.from({ length: 4 }, (_, index) => min + ((max - min) * index / 3)).reverse();
  const xTickIndexes = times.length <= 4
    ? times.map((_, index) => index)
    : [0, Math.floor((times.length - 1) / 2), times.length - 1];

  return <article className={styles.trendCard}>
    <div className={styles.trendTitle}>
      <div><span>PRECIO PROMEDIO · S/</span><h3>{category}</h3></div>
      <small>{times.length} {times.length === 1 ? "toma" : "tomas"} · cada {data?.bucketHours || 6}h</small>
    </div>

    <div className={styles.trendLegend}>
      {chains.map(chain => {
        const latest = [...points].filter(point => point.retailer === chain).sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
        return <div key={chain}><i style={{ background: CHAIN_COLORS[chain] || "#cbd5e1" }}/><span>{chain}</span><b>{pen(latest?.avgPrice)}</b></div>;
      })}
    </div>

    <div className={styles.chartWrap}>
      <svg className={styles.trendSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolución de precio promedio de ${category} por cadena`}>
        {yTicks.map((tick,index) => <g key={tick}>
          <line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} className={styles.gridLine}/>
          <text x={left-8} y={y(tick)+3} textAnchor="end" className={styles.axisText}>{Math.round(tick)}</text>
        </g>)}

        {xTickIndexes.map(index => <text key={times[index]} x={x(times[index])} y={height-12} textAnchor={index === 0 ? "start" : index === times.length-1 ? "end" : "middle"} className={styles.axisText}>{captureLabel(times[index])}</text>)}

        {chains.map(chain => {
          const chainPoints = points.filter(point => point.retailer === chain).sort((a,b) => new Date(a.at).getTime() - new Date(b.at).getTime());
          const color = CHAIN_COLORS[chain] || "#cbd5e1";
          const path = chainPoints.map((point,index) => `${index === 0 ? "M" : "L"} ${x(point.at)} ${y(point.avgPrice)}`).join(" ");
          return <g key={chain}>
            {chainPoints.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>}
            {chainPoints.map(point => <circle key={point.at+"-"+chain} cx={x(point.at)} cy={y(point.avgPrice)} r="4.5" fill={color} stroke="#0f172a" strokeWidth="2">
              <title>{chain} · {captureLabel(point.capturedAt)} · {pen(point.avgPrice)} · {number(point.skuCount)} SKU</title>
            </circle>)}
          </g>;
        })}
      </svg>
    </div>
    <p className={styles.trendFoot}>Cada punto promedia el surtido censado de la cadena en esa toma. Pasa el cursor sobre un punto para ver precio y número de SKU.</p>
  </article>;
}

function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/brands/bodegas-don-luis/chat/history", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible cargar el historial.");
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void loadHistory(); }, []);

  async function openConversation(item: Conversation) {
    if (loading || item.id === conversationId) return;
    setError("");
    try {
      const response = await fetch("/api/brands/bodegas-don-luis/chat/history?id=" + encodeURIComponent(item.id), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible abrir la conversación.");
      setConversationId(item.id);
      setMessages((Array.isArray(data.messages) ? data.messages : []).map((message: any) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.content || ""),
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible abrir la conversación.");
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/brands/bodegas-don-luis/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, messages: nextMessages }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible responder.");
      setConversationId(data.conversationId || conversationId);
      setMessages([...nextMessages, { role: "assistant", content: String(data.answer || "") }]);
      await loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible responder.");
    } finally {
      setLoading(false);
    }
  }

  const examples = [
    "¿Qué cadena tiene el precio promedio más bajo en pisco?",
    "Compárame Cuatro Gallos entre las cadenas.",
    "¿Qué marcas de ron tienen las promociones más agresivas?",
    "¿Dónde está más barato Mandatario y en qué formatos?",
  ];

  return <div className={styles.chatLayout}>
    <aside className={styles.chatHistory}>
      <div className={styles.historyTop}>
        <div><span>HISTORIAL</span><strong>Conversaciones</strong></div>
        <button onClick={newChat}>+ Nueva</button>
      </div>
      {historyLoading ? <p className={styles.muted}>Cargando historial…</p> : conversations.length ? <div className={styles.historyList}>
        {conversations.map(item => <button key={item.id} className={item.id === conversationId ? styles.historyActive : ""} onClick={() => void openConversation(item)}>
          <strong>{item.title}</strong><small>{date(item.updated_at)}</small>
        </button>)}
      </div> : <p className={styles.muted}>Todavía no hay conversaciones guardadas.</p>}
    </aside>

    <section className={styles.chatPanel}>
      <div className={styles.chatHeader}>
        <div><span className={styles.aiDot}>●</span><div><strong>MGP Pricing Intelligence</strong><small>Solo Pisco · Ron · Vino · Perú</small></div></div>
        <span className={styles.scopeBadge}>DATOS DON LUIS</span>
      </div>

      <div className={styles.messages}>
        {!messages.length && <div className={styles.chatWelcome}>
          <span>ASK THE DATA</span>
          <h2>Pregunta cualquier cosa sobre Pisco, Ron y Vino.</h2>
          <p>El asistente consulta exclusivamente la base censada de Bodegas Don Luis: precios, cadenas, marcas, formatos, promociones y evolución histórica.</p>
          <div className={styles.exampleGrid}>{examples.map(example => <button key={example} onClick={() => setInput(example)}>{example}</button>)}</div>
        </div>}
        {messages.map((message, index) => <article key={index} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
          <span>{message.role === "user" ? "Tú" : "MGP Intelligence"}</span>
          <div>{message.role === "assistant" ? <ChatMarkdown text={message.content}/> : message.content}</div>
        </article>)}
        {loading && <article className={styles.assistantMessage}><span>MGP Intelligence</span><div className={styles.thinking}>Analizando la base censada…</div></article>}
      </div>

      {error && <div className={styles.chatError}>{error}</div>}
      <form className={styles.chatForm} onSubmit={send}>
        <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="Ej: ¿Cómo está Cuatro Gallos versus el promedio de mercado?" rows={3}/>
        <button disabled={loading || !input.trim()}>{loading ? "Analizando…" : "Preguntar →"}</button>
      </form>
    </section>
  </div>;
}

export default function BodegasDonLuisPanel({ payload, locked = false }: { payload: BdlPayload; locked?: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [matrix, setMatrix] = useState<MatrixData | null>(null);
  const [matrixError, setMatrixError] = useState("");
  const [matrixLoading, setMatrixLoading] = useState(true);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [trendsError, setTrendsError] = useState("");

  useEffect(() => {
    let active = true;
    setMatrixLoading(true);
    fetch("/api/brands/bodegas-don-luis/matrix", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No fue posible cargar la comparación.");
        return data as MatrixData;
      })
      .then(data => { if (active) setMatrix(data); })
      .catch(cause => { if (active) setMatrixError(cause instanceof Error ? cause.message : "No fue posible cargar la comparación."); })
      .finally(() => { if (active) setMatrixLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setTrendsLoading(true);
    setTrendsError("");
    fetch("/api/brands/bodegas-don-luis/trends?days=30", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No fue posible cargar el histórico.");
        return data as TrendData;
      })
      .then(data => { if (active) setTrends(data); })
      .catch(cause => { if (active) setTrendsError(cause instanceof Error ? cause.message : "No fue posible cargar el histórico."); })
      .finally(() => { if (active) setTrendsLoading(false); });
    return () => { active = false; };
  }, []);

  const cells = useMemo(() => new Map((matrix?.cells || []).map(cell => [cell.retailer + "::" + cell.category, cell])), [matrix]);
  const lowest = useMemo(() => {
    const result: Record<string, number> = {};
    for (const category of CATEGORIES) {
      const prices = (matrix?.cells || []).filter(cell => cell.category === category && cell.avgPrice > 0).map(cell => cell.avgPrice);
      result[category] = prices.length ? Math.min(...prices) : 0;
    }
    return result;
  }, [matrix]);

  const categoryTotals = useMemo(() => CATEGORIES.map(category => ({
    category,
    sku: (matrix?.cells || []).filter(cell => cell.category === category).reduce((sum, cell) => sum + cell.skuCount, 0),
    promos: (matrix?.cells || []).filter(cell => cell.category === category).reduce((sum, cell) => sum + cell.promoCount, 0),
  })), [matrix]);

  const nav: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["chains", "Comparación de cadenas"],
    ["downloads", "Descargar bases"],
    ["chat", "Chat"],
  ];

  return <section className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>BODEGAS DON LUIS · PRICING INTELLIGENCE PERÚ</span>
        <h1>Bodegas Don Luis</h1>
        <p>Monitoreo continuo del mercado peruano de Pisco, Ron y Vino en las principales cadenas, con precios públicos, promociones e histórico.</p>
      </div>
      <div className={styles.heroStatus}>
        <span>{locked ? "PANEL CLIENTE" : "DEMO ACTIVA"}</span>
        <strong>Perú · PEN</strong>
        <small>Último censo {date(matrix?.lastObservedAt || payload.summary.lastObservedAt)}</small>
      </div>
    </header>

    <nav className={styles.tabs}>{nav.map(([key,label]) => <button key={key} className={tab === key ? styles.activeTab : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>

    {tab === "overview" && <div className={styles.stack}>
      <section className={styles.kpis}>
        <article><span>SKU-cadena vigentes</span><strong>{matrixLoading ? "…" : number(matrix?.totalSkuObservations)}</strong><small>Último precio por SKU y cadena</small></article>
        <article><span>Cadenas censadas</span><strong>{matrixLoading ? "…" : number(matrix?.retailers.length)}</strong><small>Tottus, Metro, Wong, Vivanda y Plaza Vea/Makro</small></article>
        <article><span>Categorías</span><strong>3</strong><small>Pisco · Ron · Vino</small></article>
        <article><span>Histórico bruto</span><strong>{number(payload.summary.listings)}</strong><small>Observaciones acumuladas</small></article>
      </section>

      <section className={styles.categoryGrid}>
        {categoryTotals.map(item => <article key={item.category}>
          <div><span>CATEGORÍA</span><h2>{item.category}</h2></div>
          <dl><div><dt>SKU-cadena</dt><dd>{matrixLoading ? "…" : number(item.sku)}</dd></div><div><dt>Promos</dt><dd>{matrixLoading ? "…" : number(item.promos)}</dd></div></dl>
        </article>)}
      </section>

      <section className={styles.trendSection}>
        <div className={styles.trendSectionHeader}>
          <div><span>EVOLUCIÓN DE MERCADO</span><h2>Precio promedio por cadena</h2><p>Una línea por cada cadena censada. El histórico se alimenta automáticamente con cada censo completo de precios.</p></div>
          <div><strong>{trendsLoading ? "Actualizando…" : `${trends?.bucketHours || 6}h`}</strong><small>frecuencia de captura</small></div>
        </div>
        {trendsError ? <div className={styles.error}>{trendsError}</div> : <div className={styles.trendGrid}>
          {TREND_CATEGORIES.map(category => <PriceTrendChart key={category} category={category} data={trends}/>)}
        </div>}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><span>COBERTURA</span><h2>Estado del monitoreo por cadena</h2></div><button onClick={() => setTab("chains")}>Ver matriz →</button></div>
        {matrixError ? <div className={styles.error}>{matrixError}</div> : <div className={styles.retailerRows}>
          {(matrix?.retailers || payload.sources.map(source => ({ name: source.retailer_name, domain: source.domain, skuCount: source.listings, observedAt: source.last_crawled_at || "" }))).map(retailer => <div key={retailer.name}>
            <div><strong>{retailer.name}</strong><span>{retailer.domain}</span></div>
            <div><b>{number(retailer.skuCount)}</b><small>SKU-cadena</small></div>
            <div><b>{date(retailer.observedAt)}</b><small>última captura</small></div>
            <span className={styles.ok}>OPERATIVO</span>
          </div>)}
        </div>}
      </section>
    </div>}

    {tab === "chains" && <section className={styles.panel}>
      <div className={styles.matrixHeader}>
        <div><span>BENCHMARK DE CADENAS</span><h2>Precio promedio por categoría</h2><p>Eje X: categorías. Eje Y: cadenas censadas. Cada celda usa el último precio vigente de cada SKU en la cadena.</p></div>
        <div className={styles.metricPill}><span>MÉTRICA</span><strong>Precio promedio SKU · S/</strong></div>
      </div>
      {matrixLoading ? <div className={styles.loading}>Construyendo matriz…</div> : matrixError ? <div className={styles.error}>{matrixError}</div> : <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <thead><tr><th>Cadena</th>{CATEGORIES.map(category => <th key={category}>{category}</th>)}</tr></thead>
          <tbody>{(matrix?.retailers || []).map(retailer => <tr key={retailer.name}>
            <th><strong>{retailer.name}</strong><small>{retailer.domain}</small></th>
            {CATEGORIES.map(category => {
              const cell = cells.get(retailer.name + "::" + category);
              const best = Boolean(cell && lowest[category] && Math.abs(cell.avgPrice - lowest[category]) < 0.001);
              return <td key={category} className={best ? styles.bestCell : ""}>
                {cell ? <><div className={styles.cellPrice}>{pen(cell.avgPrice)}{best && <span>MENOR PROMEDIO</span>}</div><small>{number(cell.skuCount)} SKU · rango {pen(cell.minPrice)} – {pen(cell.maxPrice)}</small>{cell.promoCount > 0 && <em>{number(cell.promoCount)} promociones</em>}</> : "—"}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>}
      <p className={styles.matrixNote}>El promedio es descriptivo del surtido disponible en cada cadena; el número de SKU debajo de cada celda permite interpretar diferencias de mix.</p>
    </section>}

    {tab === "downloads" && <div className={styles.stack}>
      <section className={styles.downloadHero}>
        <div><span>DATA EXPORT</span><h2>Descarga la base censada en Excel</h2><p>Incluye cadena, categoría, marca, producto, SKU fuente, precio actual y regular, descuento, stock, formato, precio por litro, URL y timestamp.</p></div>
        <a href="/api/brands/bodegas-don-luis/export">Descargar base completa ↓</a>
      </section>
      <section className={styles.downloadGrid}>
        {CATEGORIES.map(category => {
          const count = categoryTotals.find(item => item.category === category)?.sku || 0;
          return <article key={category}><span>EXCEL · {category.toUpperCase()}</span><h3>Base de {category}</h3><strong>{matrixLoading ? "…" : number(count)} <small>SKU-cadena</small></strong><p>Último precio vigente por producto y cadena.</p><a href={"/api/brands/bodegas-don-luis/export?category=" + encodeURIComponent(category)}>Descargar {category} ↓</a></article>;
        })}
      </section>
    </div>}

    {tab === "chat" && <ChatView/>}
  </section>;
}
