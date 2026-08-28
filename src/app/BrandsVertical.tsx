"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./BrandsVertical.module.css";

type Source = {
  id: string;
  retailer_name: string;
  domain: string;
  source_type: string;
  priority: number;
  last_crawled_at: string | null;
  last_status: string | null;
  last_error: string | null;
  listings: number;
  in_stock: number;
  min_price: number | null;
  max_price: number | null;
};

type Product = {
  id: string;
  sku: string | null;
  ean: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  url: string | null;
  imageUrl: string | null;
  attributes: Record<string, unknown>;
  lastSeenAt: string;
};

type Listing = {
  id: string;
  source: string;
  domain: string;
  title: string;
  seller: string | null;
  category: string | null;
  url: string;
  imageUrl: string | null;
  regularPrice: number | null;
  currentPrice: number | null;
  currency: string;
  inStock: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  observedAt: string;
};

type LiveItem = {
  key: string;
  name: string;
  category: string;
  marketCategory?: string;
  currentPrice: number;
  regularPrice: number | null;
  discountPct: number | null;
  units: number | null;
  unitPrice: number | null;
  benchmark: string | null;
  benchmarkLabel: string | null;
  promotion?: boolean;
  promoMechanic?: string | null;
};

type LiveSource = {
  role: "brand" | "competitor";
  brand: string;
  channel: string;
  location: string;
  url: string;
  domain?: string;
  status: "ok" | "degraded";
  observedAt: string;
  items: LiveItem[];
  metrics: { items: number; promoItems: number; lowestPrice: number | null; maxDiscountPct: number | null };
  error: string | null;
};

type LiveBenchmark = {
  key: string;
  label: string;
  subject: { brand: string; price: number; unitPrice: number | null };
  competitor: { brand: string; price: number; unitPrice: number | null };
  gapPct: number | null;
  leader: string | null;
  note: string;
};

type HistoryPoint = {
  date: string;
  brand: string;
  role: "brand" | "competitor";
  category: string;
  avgPrice: number;
  avgUnitPrice: number;
  minPrice: number;
  maxPrice: number;
  products: number;
};

type PriceHistory = {
  policy: "official-only" | string;
  days: number;
  from: string | null;
  to: string | null;
  categories: string[];
  points: HistoryPoint[];
};

type LivePulse = {
  status: "live" | "partial" | "unavailable";
  mode?: "persisted" | "live";
  freshness?: "fresh" | "recent" | "stale" | "unavailable";
  sourcePolicy?: "official-only" | string;
  category: string;
  subjectBrand: string;
  competitorBrand: string;
  channel: string;
  market: string;
  observedAt: string;
  sources: LiveSource[];
  benchmarks: LiveBenchmark[];
  history?: PriceHistory;
};

type Payload = {
  brand: { id: string; slug: string; name: string; countryCode: string; officialUrl: string | null };
  summary: { products: number; sources: number; listings: number; sellers: number; inStockPct: number | null; promoPct: number | null; lastObservedAt: string | null };
  sources: Source[];
  products: Product[];
  listings: Listing[];
  lastRun: null | { status: string; sourcesAttempted: number; sourcesSucceeded: number; listingsFound: number; productsFound: number; startedAt: string | null; finishedAt: string | null; notes: string | null };
  live: LivePulse | null;
};

type Tab = "overview" | "copilot" | "competition" | "pricing-lab" | "promotions" | "packs" | "profitability" | "products" | "retailers" | "listings";

const BRAND_OPTIONS = [
  { slug: "piwen", name: "Piwén", detail: "Frutos secos · Pricing demo" },
  { slug: "krispy-kreme", name: "Krispy Kreme", detail: "vs Dunkin · QSR" },
  { slug: "little-caesars", name: "Little Caesars", detail: "vs Papa Johns · QSR" },
  { slug: "victorinox", name: "Victorinox", detail: "Retail intelligence" },
];

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("es-CL");

function moneyOrDash(value: number | null) { return value && value > 0 ? money.format(value) : "—"; }
function dateOrDash(value: string | null) { return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function shortDate(value: string) { return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`)); }
function percent(value: number | null) { return value == null ? "—" : `${Math.abs(value).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`; }
function pulseLabel(live: LivePulse) {
  if (live.mode === "persisted") {
    if (live.freshness === "fresh") return "CAPTURA VERIFICADA";
    if (live.freshness === "recent") return "CAPTURA RECIENTE";
    if (live.freshness === "stale") return "ÚLTIMA CAPTURA";
  }
  return live.status === "live" ? "ACTUALIZADO" : live.status === "partial" ? "DATOS PARCIALES" : "SIN SEÑAL";
}
function benchmarkSignal(item: LiveBenchmark) {
  if (item.gapPct == null) return `${item.label}: sin brecha comparable.`;
  if (item.gapPct > 0) return `${item.subject.brand} está ${percent(item.gapPct)} por sobre ${item.competitor.brand}.`;
  if (item.gapPct < 0) return `${item.subject.brand} tiene una ventaja de ${percent(item.gapPct)} frente a ${item.competitor.brand}.`;
  return `${item.label}: paridad de precio.`;
}

function PriceHistoryChart({ history, category, subjectBrand, competitorBrand }: { history: PriceHistory; category: string; subjectBrand: string; competitorBrand: string }) {
  const points = history.points.filter(item => item.category === category);
  const dates = Array.from(new Set(points.map(item => item.date))).sort();
  const useUnitPrice = category.startsWith("Packs ·");
  const metric = (item: HistoryPoint) => useUnitPrice ? item.avgUnitPrice : item.avgPrice;
  const subject = points.filter(item => item.brand === subjectBrand).sort((a, b) => a.date.localeCompare(b.date));
  const competitor = points.filter(item => item.brand === competitorBrand).sort((a, b) => a.date.localeCompare(b.date));
  const values = points.map(metric).filter(value => Number.isFinite(value) && value > 0);

  if (!values.length) return <div className={styles.historyEmpty}>Todavía no hay observaciones oficiales para esta categoría.</div>;

  const width = 840;
  const height = 280;
  const left = 70;
  const right = 24;
  const top = 24;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  let min = Math.min(...values);
  let max = Math.max(...values);
  const spread = Math.max(max - min, max * 0.12, 500);
  min = Math.max(0, min - spread * 0.18);
  max = max + spread * 0.18;
  const x = (date: string) => dates.length <= 1 ? left + plotWidth / 2 : left + (dates.indexOf(date) / (dates.length - 1)) * plotWidth;
  const y = (value: number) => top + ((max - value) / Math.max(max - min, 1)) * plotHeight;
  const path = (rows: HistoryPoint[]) => rows.map((item, index) => `${index ? "L" : "M"}${x(item.date).toFixed(1)},${y(metric(item)).toFixed(1)}`).join(" ");
  const latestSubject = subject.at(-1);
  const latestCompetitor = competitor.at(-1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(factor => ({ value: max - (max - min) * factor, y: top + plotHeight * factor }));
  const dateLabels = dates.length <= 5 ? dates : [dates[0], dates[Math.floor(dates.length / 2)], dates.at(-1)!];

  return <div className={styles.historyChart}>
    <div className={styles.historyMetricRow}>
      <span>{useUnitPrice ? "Precio promedio por unidad" : "Precio promedio por producto"}</span>
      <div>
        <strong>{subjectBrand}: {moneyOrDash(latestSubject ? metric(latestSubject) : null)}</strong>
        <strong>{competitorBrand}: {moneyOrDash(latestCompetitor ? metric(latestCompetitor) : null)}</strong>
      </div>
    </div>
    <svg className={styles.historySvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolución de precios de ${category}`}>
      {ticks.map(tick => <g key={tick.y}>
        <line className={styles.historyGridLine} x1={left} y1={tick.y} x2={width - right} y2={tick.y} />
        <text className={styles.historyAxisText} x={left - 10} y={tick.y + 4} textAnchor="end">{money.format(Math.round(tick.value))}</text>
      </g>)}
      {dateLabels.map(date => <text key={date} className={styles.historyAxisText} x={x(date)} y={height - 12} textAnchor="middle">{shortDate(date)}</text>)}
      {subject.length > 1 && <path className={styles.historySubjectLine} d={path(subject)} />}
      {competitor.length > 1 && <path className={styles.historyCompetitorLine} d={path(competitor)} />}
      {subject.map(item => <circle key={`s-${item.date}`} className={styles.historySubjectDot} cx={x(item.date)} cy={y(metric(item))} r="5" />)}
      {competitor.map(item => <circle key={`c-${item.date}`} className={styles.historyCompetitorDot} cx={x(item.date)} cy={y(metric(item))} r="5" />)}
    </svg>
    <div className={styles.historyLegend}>
      <span><i className={styles.historySubjectSwatch} />{subjectBrand}</span>
      <span><i className={styles.historyCompetitorSwatch} />{competitorBrand}</span>
    </div>
    {dates.length === 1 && <div className={styles.historyStart}>Histórico oficial iniciado hoy. La curva se irá construyendo automáticamente con cada nueva captura.</div>}
  </div>;
}


type PiwenSkuPreset = {
  id: string;
  name: string;
  currentPrice: number;
  marketPrice: number;
  productCost: number;
  packaging: number;
  fulfillment: number;
  monthlyUnits: number;
  elasticity: number;
};

const PIWEN_SKUS: PiwenSkuPreset[] = [
  { id: "caju-1kg", name: "Castañas de cajú sin sal 1 kg", currentPrice: 23800, marketPrice: 30417, productCost: 10800, packaging: 650, fulfillment: 850, monthlyUnits: 420, elasticity: -1.25 },
  { id: "almendra-250", name: "Almendra natural 250 g", currentPrice: 5450, marketPrice: 4282, productCost: 2350, packaging: 280, fulfillment: 420, monthlyUnits: 760, elasticity: -1.1 },
  { id: "pistacho-80", name: "Pistacho sin sal 80 g", currentPrice: 3150, marketPrice: 2840, productCost: 1220, packaging: 180, fulfillment: 290, monthlyUnits: 690, elasticity: -1.35 },
];

const PIWEN_CHANNELS = [
  { id: "direct", name: "Piwén.cl", commission: 0 },
  { id: "marketplace", name: "Marketplace", commission: 14 },
  { id: "retail", name: "Retail moderno", commission: 25 },
];

function safeNumber(value: number) { return Number.isFinite(value) ? value : 0; }
function roundPrice(value: number) { return Math.max(0, Math.round(value / 10) * 10); }
function pctSigned(value: number) { return `${value >= 0 ? "+" : ""}${value.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`; }

function renderCopilotInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function CopilotMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: JSX.Element[] = [];
  let index = 0;
  let blockKey = 0;

  const parseRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  const isSeparator = (line: string) => {
    const cells = parseRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
  };

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("|") && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const header = parseRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(parseRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className={styles.copilotTableWrap} key={`table-${blockKey++}`}>
          <table className={styles.copilotTable}>
            <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{renderCopilotInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex}>{renderCopilotInline(row[cellIndex] || "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      blocks.push(level <= 2
        ? <h3 className={styles.copilotHeading} key={`heading-${blockKey++}`}>{renderCopilotInline(text)}</h3>
        : <h4 className={styles.copilotSubheading} key={`heading-${blockKey++}`}>{renderCopilotInline(text)}</h4>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul className={styles.copilotList} key={`list-${blockKey++}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderCopilotInline(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(<ol className={styles.copilotList} key={`olist-${blockKey++}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderCopilotInline(item)}</li>)}</ol>);
      continue;
    }

    if (/^\*[^*].*\*$/.test(line)) {
      blocks.push(<div className={styles.copilotNote} key={`note-${blockKey++}`}>{renderCopilotInline(line.slice(1, -1))}</div>);
      index += 1;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+[.)]\s+/.test(lines[index].trim()) &&
      !(lines[index].trim().startsWith("|") && index + 1 < lines.length && isSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p className={styles.copilotParagraph} key={`p-${blockKey++}`}>{renderCopilotInline(paragraph.join(" "))}</p>);
  }

  return <div className={styles.copilotMarkdown}>{blocks}</div>;
}

function PiwenPricingCopilot() {
  const starter = "Hola. Soy Pricing Copilot de Piwén. Puedo analizar brechas vs competencia, simular cambios de precio, promociones, margen y rentabilidad por canal. ¿Qué quieres evaluar?";
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([{ role: "assistant", content: starter }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("GPT-5.6 Sol");

  const suggestions = [
    "¿Qué productos están más desalineados vs mercado?",
    "¿Qué pasa si bajo 8% el pistacho?",
    "¿Qué precio recomendarías para castañas de cajú?",
    "¿Qué promo tendría mejor lógica económica?",
  ];

  const ask = async (question: string) => {
    const clean = question.trim();
    if (!clean || loading) return;
    const next = [...messages, { role: "user" as const, content: clean }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/piwen-pricing-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.answer) throw new Error(data?.error || "No fue posible consultar Pricing Copilot.");
      setMessages(current => [...current, { role: "assistant", content: String(data.answer) }]);
      if (typeof data?.model === "string" && data.model) setModel(data.model.replace("gpt-5.6-sol", "GPT-5.6 Sol").replace("gpt-5.6", "GPT-5.6 Sol"));
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", content: error instanceof Error ? error.message : "No fue posible consultar Pricing Copilot." }]);
    } finally {
      setLoading(false);
    }
  };

  return <div className={styles.piwenCopilot}>
    <article className={styles.piwenCopilotHero}>
      <div>
        <span>AI PRICING ADVISOR</span>
        <h2>Pricing Copilot</h2>
        <p>Consulta en lenguaje natural la inteligencia de precios de Piwén y prueba escenarios antes de tomar una decisión.</p>
      </div>
      <div className={styles.piwenCopilotModel}><i />Impulsado por <strong>{model}</strong><small>Contexto Piwén · Super Precios</small></div>
    </article>

    <div className={styles.piwenCopilotGrid}>
      <aside className={styles.piwenCopilotAside}>
        <span>PREGUNTAS SUGERIDAS</span>
        {suggestions.map(item => <button key={item} onClick={() => ask(item)} disabled={loading}>{item}<b>→</b></button>)}
        <div className={styles.piwenCopilotScope}>
          <strong>Qué entiende</strong>
          <p>Benchmarks por kg, brechas de canal, supuestos de costo, elasticidad, promociones y rentabilidad.</p>
          <small>Los costos y el histórico de 30 días están identificados como supuestos/demo hasta conectar datos reales.</small>
        </div>
      </aside>

      <section className={styles.piwenChat}>
        <div className={styles.piwenChatMessages}>
          {messages.map((message, index) => <div key={index} className={message.role === "user" ? styles.piwenUserMessage : styles.piwenAssistantMessage}>
            <span>{message.role === "user" ? "TÚ" : "PRICING COPILOT"}</span>
            {message.role === "assistant" ? <CopilotMarkdown content={message.content} /> : <p>{message.content}</p>}
          </div>)}
          {loading && <div className={styles.piwenAssistantMessage}><span>PRICING COPILOT</span><p className={styles.piwenThinking}>Analizando pricing, margen y contexto competitivo…</p></div>}
        </div>
        <form className={styles.piwenChatComposer} onSubmit={event => { event.preventDefault(); void ask(input); }}>
          <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(input);
            }
          }} placeholder="Ej: Si quiero mantener un margen mínimo de 30%, ¿hasta cuánto puedo bajar castañas de cajú?" rows={2} />
          <button type="submit" disabled={loading || !input.trim()}>{loading ? "Analizando…" : "Preguntar ↗"}</button>
        </form>
      </section>
    </div>
  </div>;
}

function PiwenPricingLab() {
  const [skuId, setSkuId] = useState(PIWEN_SKUS[0].id);
  const preset = PIWEN_SKUS.find(item => item.id === skuId) || PIWEN_SKUS[0];
  const [price, setPrice] = useState(preset.currentPrice);
  const [cost, setCost] = useState(preset.productCost);
  const [packaging, setPackaging] = useState(preset.packaging);
  const [fulfillment, setFulfillment] = useState(preset.fulfillment);
  const [marketPrice, setMarketPrice] = useState(preset.marketPrice);
  const [baseUnits, setBaseUnits] = useState(preset.monthlyUnits);
  const [elasticity, setElasticity] = useState(preset.elasticity);
  const [channelId, setChannelId] = useState("direct");
  const [minMargin, setMinMargin] = useState(30);
  const [targetIndex, setTargetIndex] = useState(100);

  const loadSku = (nextId: string) => {
    const next = PIWEN_SKUS.find(item => item.id === nextId) || PIWEN_SKUS[0];
    setSkuId(nextId);
    setPrice(next.currentPrice);
    setCost(next.productCost);
    setPackaging(next.packaging);
    setFulfillment(next.fulfillment);
    setMarketPrice(next.marketPrice);
    setBaseUnits(next.monthlyUnits);
    setElasticity(next.elasticity);
  };

  const channel = PIWEN_CHANNELS.find(item => item.id === channelId) || PIWEN_CHANNELS[0];
  const commissionRate = channel.commission / 100;
  const variableCost = safeNumber(cost + packaging + fulfillment);
  const netRevenue = price * (1 - commissionRate);
  const contribution = netRevenue - variableCost;
  const marginPct = netRevenue > 0 ? contribution / netRevenue * 100 : 0;
  const priceIndex = marketPrice > 0 ? price / marketPrice * 100 : 0;
  const priceRatio = preset.currentPrice > 0 ? price / preset.currentPrice : 1;
  const projectedUnits = Math.max(0, Math.round(baseUnits * Math.pow(Math.max(priceRatio, .01), elasticity)));
  const projectedRevenue = projectedUnits * price;
  const projectedContribution = projectedUnits * contribution;
  const currentNetRevenue = preset.currentPrice * (1 - commissionRate);
  const currentContribution = currentNetRevenue - variableCost;
  const currentTotalContribution = baseUnits * currentContribution;
  const contributionDelta = currentTotalContribution !== 0 ? (projectedContribution / currentTotalContribution - 1) * 100 : 0;
  const targetCompetitivePrice = marketPrice * targetIndex / 100;
  const targetMarginRate = Math.min(Math.max(minMargin / 100, 0), .9);
  const minNetRevenue = variableCost / Math.max(1 - targetMarginRate, .05);
  const minGrossPrice = minNetRevenue / Math.max(1 - commissionRate, .05);
  const recommendedPrice = roundPrice(Math.max(targetCompetitivePrice, minGrossPrice));

  return <div className={styles.piwenLab}>
    <article className={styles.piwenIntro}>
      <div><span>DECISION ENGINE · DEMO</span><h2>Pricing Lab</h2><p>Simula precio, rentabilidad, posición competitiva y respuesta de volumen antes de ejecutar un cambio.</p></div>
      <em>Los costos y elasticidades son supuestos editables para la demostración.</em>
    </article>

    <div className={styles.piwenLabGrid}>
      <article className={styles.piwenControls}>
        <div className={styles.piwenControlHeader}><div><span>ESCENARIO</span><h3>Variables de decisión</h3></div><strong>{preset.name}</strong></div>
        <label><span>SKU</span><select value={skuId} onChange={event => loadSku(event.target.value)}>{PIWEN_SKUS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className={styles.piwenFieldGrid}>
          <label><span>Precio simulado</span><input type="number" value={price} onChange={e=>setPrice(Number(e.target.value))}/><small>{money.format(price)}</small></label>
          <label><span>Benchmark mercado</span><input type="number" value={marketPrice} onChange={e=>setMarketPrice(Number(e.target.value))}/><small>Base índice 100</small></label>
          <label><span>Costo producto</span><input type="number" value={cost} onChange={e=>setCost(Number(e.target.value))}/></label>
          <label><span>Packaging</span><input type="number" value={packaging} onChange={e=>setPackaging(Number(e.target.value))}/></label>
          <label><span>Fulfillment</span><input type="number" value={fulfillment} onChange={e=>setFulfillment(Number(e.target.value))}/></label>
          <label><span>Volumen base / mes</span><input type="number" value={baseUnits} onChange={e=>setBaseUnits(Number(e.target.value))}/></label>
          <label><span>Elasticidad</span><input type="number" step=".05" value={elasticity} onChange={e=>setElasticity(Number(e.target.value))}/></label>
          <label><span>Canal</span><select value={channelId} onChange={e=>setChannelId(e.target.value)}>{PIWEN_CHANNELS.map(item=><option key={item.id} value={item.id}>{item.name} · {item.commission}% fee</option>)}</select></label>
        </div>
        <label className={styles.piwenRange}><span>Precio: {money.format(price)}</span><input type="range" min={Math.round(preset.currentPrice*.65)} max={Math.round(preset.currentPrice*1.35)} step="10" value={price} onChange={e=>setPrice(Number(e.target.value))}/><small>{money.format(Math.round(preset.currentPrice*.65))}<b>Actual {money.format(preset.currentPrice)}</b>{money.format(Math.round(preset.currentPrice*1.35))}</small></label>
      </article>

      <article className={styles.piwenResultPanel}>
        <div className={styles.piwenResultHeader}><div><span>RESULTADO SIMULADO</span><h3>{money.format(price)}</h3></div><b className={marginPct >= minMargin ? styles.piwenGood : styles.piwenWarn}>{marginPct.toFixed(1)}% margen</b></div>
        <div className={styles.piwenMetricGrid}>
          <div><span>Price Index</span><strong>{priceIndex.toFixed(0)}</strong><small>{priceIndex > 100 ? "premium vs benchmark" : "ventaja vs benchmark"}</small></div>
          <div><span>Contribución / unidad</span><strong>{money.format(contribution)}</strong><small>después de costos y fee</small></div>
          <div><span>Volumen proyectado</span><strong>{number.format(projectedUnits)}</strong><small>{pctSigned((projectedUnits/baseUnits-1)*100)} vs base</small></div>
          <div><span>Facturación mensual</span><strong>{money.format(projectedRevenue)}</strong><small>escenario simulado</small></div>
          <div><span>Contribución mensual</span><strong>{money.format(projectedContribution)}</strong><small>{pctSigned(contributionDelta)} vs actual</small></div>
          <div><span>Fee canal</span><strong>{channel.commission}%</strong><small>{channel.name}</small></div>
        </div>
        <div className={styles.piwenRecommendation}>
          <span>PRECIO RECOMENDADO</span>
          <strong>{money.format(recommendedPrice)}</strong>
          <p>Respeta margen mínimo de <b>{minMargin}%</b> y objetivo de Price Index <b>{targetIndex}</b>. Precio mínimo rentable: {money.format(roundPrice(minGrossPrice))}.</p>
          <div><label>Margen mín. <input type="number" value={minMargin} onChange={e=>setMinMargin(Number(e.target.value))}/>%</label><label>Índice objetivo <input type="number" value={targetIndex} onChange={e=>setTargetIndex(Number(e.target.value))}/></label></div>
        </div>
      </article>
    </div>
  </div>;
}

function PiwenPromoSimulator() {
  const [price, setPrice] = useState(23800);
  const [variableCost, setVariableCost] = useState(12300);
  const [baseUnits, setBaseUnits] = useState(420);
  const [mechanic, setMechanic] = useState("20off");
  const [uplift, setUplift] = useState(35);
  const effectivePrice = mechanic === "20off" ? price*.8 : mechanic === "second50" ? price*.75 : mechanic === "2x1" ? price*.5 : price*(2/3);
  const currentContribution = price-variableCost;
  const promoContribution = effectivePrice-variableCost;
  const breakEvenLift = promoContribution > 0 ? Math.max(0, currentContribution/promoContribution-1)*100 : Infinity;
  const promoUnits = Math.round(baseUnits*(1+uplift/100));
  const promoTotal = promoUnits*promoContribution;
  const baseTotal = baseUnits*currentContribution;
  const delta = baseTotal ? (promoTotal/baseTotal-1)*100 : 0;
  return <div className={styles.piwenLab}>
    <article className={styles.piwenIntro}><div><span>PROMOTION ECONOMICS</span><h2>Promo Simulator</h2><p>Compara mecánicas promocionales y calcula cuánto volumen adicional necesitas para proteger la contribución.</p></div><em>Supuestos demo editables.</em></article>
    <div className={styles.piwenLabGrid}>
      <article className={styles.piwenControls}>
        <div className={styles.piwenFieldGrid}>
          <label><span>Precio lista</span><input type="number" value={price} onChange={e=>setPrice(Number(e.target.value))}/></label>
          <label><span>Costo variable unitario</span><input type="number" value={variableCost} onChange={e=>setVariableCost(Number(e.target.value))}/></label>
          <label><span>Volumen base / mes</span><input type="number" value={baseUnits} onChange={e=>setBaseUnits(Number(e.target.value))}/></label>
          <label><span>Mecánica</span><select value={mechanic} onChange={e=>setMechanic(e.target.value)}><option value="20off">20% descuento</option><option value="second50">2ª unidad -50%</option><option value="3for2">3x2</option><option value="2x1">2x1</option></select></label>
        </div>
        <label className={styles.piwenRange}><span>Uplift de volumen esperado: +{uplift}%</span><input type="range" min="0" max="150" step="5" value={uplift} onChange={e=>setUplift(Number(e.target.value))}/><small>0%<b>Supuesto comercial</b>+150%</small></label>
      </article>
      <article className={styles.piwenResultPanel}>
        <div className={styles.piwenMetricGrid}>
          <div><span>Precio efectivo / unidad</span><strong>{money.format(effectivePrice)}</strong></div>
          <div><span>Contribución promo / unidad</span><strong>{money.format(promoContribution)}</strong></div>
          <div><span>Uplift break-even</span><strong>{Number.isFinite(breakEvenLift)?`+${breakEvenLift.toFixed(0)}%`:"No rentable"}</strong><small>para igualar contribución base</small></div>
          <div><span>Unidades promo</span><strong>{number.format(promoUnits)}</strong></div>
          <div><span>Contribución promo</span><strong>{money.format(promoTotal)}</strong></div>
          <div><span>Impacto vs base</span><strong className={delta>=0?styles.piwenGoodText:styles.piwenWarnText}>{pctSigned(delta)}</strong></div>
        </div>
        <div className={styles.piwenRecommendation}><span>LECTURA</span><strong>{delta>=0?"Promoción crea valor":"Promoción destruye contribución"}</strong><p>Con esta mecánica necesitas aproximadamente <b>{Number.isFinite(breakEvenLift)?`+${breakEvenLift.toFixed(0)}%`:"un margen mayor"}</b> de volumen para quedar en break-even.</p></div>
      </article>
    </div>
  </div>;
}

function PiwenPackArchitecture() {
  const [prices, setPrices] = useState({ p250:3550, p1000:11800, p5000:30600 });
  const rows = [
    { id:"p250", label:"250 g · D2C", grams:250, price:prices.p250 },
    { id:"p1000", label:"1 kg · D2C", grams:1000, price:prices.p1000 },
    { id:"p5000", label:"5 kg · Mayorista", grams:5000, price:prices.p5000 },
  ];
  const baseKg = rows[0].price/(rows[0].grams/1000);
  return <div className={styles.piwenLab}>
    <article className={styles.piwenIntro}><div><span>PACK ARCHITECTURE</span><h2>Escalera de formatos</h2><p>Normaliza cada formato a $/kg y valida que el ahorro por tamaño sea consistente y entendible.</p></div><em>Ejemplo: Mix Aconcagua.</em></article>
    <article className={styles.piwenPackPanel}>
      <div className={styles.piwenPackRows}>
        {rows.map(row => {
          const kg = row.price/(row.grams/1000);
          const saving = (1-kg/baseKg)*100;
          return <div key={row.id} className={styles.piwenPackRow}>
            <div><span>{row.label}</span><input type="number" value={row.price} onChange={e=>setPrices(current=>({...current,[row.id]:Number(e.target.value)}))}/></div>
            <strong>{money.format(kg)}<small>/ kg</small></strong>
            <b className={saving>=0?styles.piwenGood:styles.piwenWarn}>{saving<=.1?"Base":`-${saving.toFixed(1)}% / kg`}</b>
          </div>;
        })}
      </div>
      <div className={styles.piwenRecommendation}><span>ARQUITECTURA</span><strong>Premium de conveniencia → ahorro familiar → escalón mayorista</strong><p>El formato grande debería reducir progresivamente el $/kg. El sistema puede alertar automáticamente cuando un pack rompe esa lógica.</p></div>
    </article>
  </div>;
}

function PiwenChannelProfitability() {
  const [cost, setCost] = useState(10800);
  const [rows, setRows] = useState([
    { id:"direct", channel:"Piwén.cl", price:23800, fee:0, logistics:1500, trade:0 },
    { id:"ml", channel:"Marketplace", price:16480, fee:14, logistics:1100, trade:0 },
    { id:"wholesale", channel:"Mayorista", price:15400, fee:0, logistics:650, trade:6 },
    { id:"retail", channel:"Retail moderno", price:23800, fee:0, logistics:700, trade:28 },
  ]);
  const patch = (id:string,key:string,value:number) => setRows(current=>current.map(row=>row.id===id?{...row,[key]:value}:row));
  return <div className={styles.piwenLab}>
    <article className={styles.piwenIntro}><div><span>CHANNEL PROFITABILITY</span><h2>Rentabilidad por canal</h2><p>No basta comparar PVP: traduce precio, fees, descuentos y logística a contribución real por canal.</p></div><label className={styles.piwenInlineInput}>Costo producto <input type="number" value={cost} onChange={e=>setCost(Number(e.target.value))}/></label></article>
    <article className={styles.piwenChannelTable}>
      <div className={styles.piwenChannelHead}><span>Canal</span><span>Precio</span><span>Fee %</span><span>Trade %</span><span>Logística</span><span>Ingreso neto</span><span>Margen</span></div>
      {rows.map(row => {
        const net = row.price*(1-row.fee/100-row.trade/100);
        const contribution = net-cost-row.logistics;
        const margin = net>0?contribution/net*100:0;
        return <div className={styles.piwenChannelRow} key={row.id}>
          <strong>{row.channel}</strong>
          <input type="number" value={row.price} onChange={e=>patch(row.id,"price",Number(e.target.value))}/>
          <input type="number" value={row.fee} onChange={e=>patch(row.id,"fee",Number(e.target.value))}/>
          <input type="number" value={row.trade} onChange={e=>patch(row.id,"trade",Number(e.target.value))}/>
          <input type="number" value={row.logistics} onChange={e=>patch(row.id,"logistics",Number(e.target.value))}/>
          <span>{money.format(net)}</span>
          <b className={margin>=30?styles.piwenGood:margin>=15?styles.piwenNeutral:styles.piwenWarn}>{margin.toFixed(1)}%</b>
        </div>;
      })}
      <small>Supuestos demostrativos: reemplazables por costos, rebates, fees y logística real de Piwén.</small>
    </article>
  </div>;
}

export default function BrandsVertical({ initialBrand = "krispy-kreme" }: { initialBrand?: string }) {
  const [selectedBrand, setSelectedBrand] = useState(initialBrand);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [historyCategory, setHistoryCategory] = useState("");

  useEffect(() => {
    setSelectedBrand(initialBrand);
  }, [initialBrand]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSource("");
    setQuery("");
    setHistoryCategory("");
    fetch(`/api/brands?brand=${encodeURIComponent(selectedBrand)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "brands_failed"); return await response.json() as Payload; })
      .then(value => { if (active) setPayload(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar Brands."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedBrand]);

  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payload?.listings || []).filter(item => (!source || item.domain === source) && (!q || `${item.title} ${item.seller || ""} ${item.category || ""}`.toLowerCase().includes(q)));
  }, [payload, query, source]);
  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payload?.products || []).filter(item => !q || `${item.name} ${item.sku || ""} ${item.ean || ""} ${item.category || ""}`.toLowerCase().includes(q));
  }, [payload, query]);

  if (loading) return <section className={styles.shell}><div className={styles.state}>Actualizando inteligencia competitiva…</div></section>;
  if (error || !payload) return <section className={styles.shell}><div className={styles.error}>{error || "Brands no está disponible."}</div></section>;

  const run = payload.lastRun;
  const live = payload.live;
  const qsr = payload.brand.slug === "krispy-kreme" || payload.brand.slug === "little-caesars";
  const officialOnly = live?.sourcePolicy === "official-only";
  const brandSource = live?.sources.find(item => item.role === "brand");
  const competitorSource = live?.sources.find(item => item.role === "competitor");
  const monitoredPrices = live?.sources.reduce((sum, item) => sum + item.metrics.items, 0) || payload.summary.listings;
  const pack6 = live?.benchmarks.find(item => item.key === "pack-6");
  const pack12 = live?.benchmarks.find(item => item.key === "pack-12");
  const pack24 = live?.benchmarks.find(item => item.key === "pack-24");
  const history = live?.history;
  const activeHistoryCategory = historyCategory || history?.categories.find(item => item === "Packs · 12 unidades") || history?.categories[0] || "";

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>{qsr ? "FOOD SERVICE · COMPETITIVE PRICING INTELLIGENCE" : "BRANDS · RETAIL & COMPETITIVE INTELLIGENCE"}</span>
        <h1>{qsr ? `${payload.brand.name} Market Intelligence` : payload.brand.name}</h1>
        <p>{live ? `Monitoreo de precios, categorías y arquitectura competitiva de ${live.subjectBrand} vs ${live.competitorBrand}${officialOnly ? " usando exclusivamente sus canales web oficiales" : ""}.` : "Descubrimiento de canales, catálogo, precios y presencia digital."}</p>
      </div>
      <label className={styles.brandPicker}>
        <span>Vertical analizada</span>
        <select value={selectedBrand} onChange={event => { setSelectedBrand(event.target.value); setTab("overview"); }}>
          {BRAND_OPTIONS.map(item => <option key={item.slug} value={item.slug}>{item.name} · {item.detail}</option>)}
        </select>
        <small>Chile · inteligencia competitiva</small>
      </label>
    </div>

    <nav className={styles.tabs} aria-label="Secciones Brands">
      {([["overview",qsr ? "Resumen ejecutivo" : "Overview"], ...(live ? [["competition","Competencia"]] : []), ...(selectedBrand === "piwen" ? [["copilot","Pricing Copilot"],["pricing-lab","Pricing Lab"],["promotions","Promociones"],["packs","Packs"],["profitability","Rentabilidad"]] : []), ["products","Productos"],["retailers","Fuentes"],["listings","Evidencia"]] as [Tab,string][]).map(([key,label]) => <button key={key} className={tab===key?styles.activeTab:""} onClick={()=>setTab(key)}>{label}</button>)}
    </nav>

    {tab === "overview" && <>
      {live && <article className={styles.competitionBanner}>
        <div className={styles.competitionHeadline}>
          <div>
            <div className={styles.badgeRow}>
              <span className={live.status === "unavailable" ? styles.partial : styles.live}>{pulseLabel(live)}</span>
              {officialOnly && <span className={styles.officialBadge}>FUENTES OFICIALES</span>}
            </div>
            <h2>{live.subjectBrand} <i>vs</i> {live.competitorBrand}</h2>
            <p>{live.channel} · {live.market} · última observación {dateOrDash(live.observedAt)}</p>
          </div>
          <button onClick={() => setTab("competition")}>Ver detalle competitivo →</button>
        </div>
        <div className={styles.pulseGrid}>
          {[brandSource, competitorSource].filter((item): item is LiveSource => Boolean(item)).map(item => <div key={item.brand} className={styles.pulseCard}>
            <span>{item.role === "brand" ? "MARCA ANALIZADA" : "COMPETIDOR DIRECTO"}</span>
            <strong>{item.brand}</strong>
            <div><b>{item.metrics.items}</b><small> precios monitoreados</small></div>
            <div><b>{item.metrics.promoItems}</b><small> combos / promos</small></div>
            <div><b>{moneyOrDash(item.metrics.lowestPrice)}</b><small> precio de entrada</small></div>
          </div>)}
        </div>
      </article>}

      {live?.benchmarks.length ? <div className={styles.benchmarkGrid}>
        {live.benchmarks.slice(0, 6).map(benchmark => <article key={benchmark.key} className={styles.benchmarkCard}>
          <span>{benchmark.label} · BENCHMARK OFICIAL</span>
          <div className={styles.benchmarkPrices}>
            <div><small>{benchmark.subject.brand}</small><strong>{moneyOrDash(benchmark.subject.price)}</strong>{benchmark.subject.unitPrice && benchmark.subject.unitPrice !== benchmark.subject.price ? <em>{moneyOrDash(benchmark.subject.unitPrice)} / unidad</em> : null}</div>
            <div><small>{benchmark.competitor.brand}</small><strong>{moneyOrDash(benchmark.competitor.price)}</strong>{benchmark.competitor.unitPrice && benchmark.competitor.unitPrice !== benchmark.competitor.price ? <em>{moneyOrDash(benchmark.competitor.unitPrice)} / unidad</em> : null}</div>
          </div>
          <p><b>{benchmark.leader || "—"}</b> lidera · brecha {percent(benchmark.gapPct)}</p>
          <small className={styles.note}>{benchmarkSignal(benchmark)}</small>
        </article>)}
      </div> : null}

      {qsr && live ? <div className={styles.kpis}>
        <article><span>Precios monitoreados</span><strong>{number.format(monitoredPrices)}</strong></article>
        <article><span>Benchmarks homologables</span><strong>{live.benchmarks.length}</strong></article>
        <article><span>Categorías históricas</span><strong>{history?.categories.length ?? 0}</strong></article>
        <article><span>Brecha pack 6</span><strong>{pack6 ? percent(pack6.gapPct) : "—"}</strong></article>
        <article><span>Brecha docena</span><strong>{pack12 ? percent(pack12.gapPct) : "—"}</strong></article>
        <article><span>Fuentes activas</span><strong>{payload.summary.sources}</strong></article>
      </div> : <div className={styles.kpis}>
        <article><span>Productos detectados</span><strong>{number.format(payload.summary.products)}</strong></article>
        <article><span>Fuentes monitoreadas</span><strong>{number.format(payload.summary.sources)}</strong></article>
        <article><span>Listings históricos</span><strong>{number.format(payload.summary.listings)}</strong></article>
        <article><span>Sellers detectados</span><strong>{number.format(payload.summary.sellers)}</strong></article>
        <article><span>Disponibilidad</span><strong>{payload.summary.inStockPct == null ? "—" : `${payload.summary.inStockPct}%`}</strong></article>
        <article><span>En promoción</span><strong>{payload.summary.promoPct == null ? "—" : `${payload.summary.promoPct}%`}</strong></article>
      </div>}

      {history && activeHistoryCategory && <article className={`${styles.panel} ${styles.historyPanel}`}>
        <div className={styles.historyHeader}>
          <div>
            <div className={styles.badgeRow}><span className={styles.officialBadge}>{history.policy === "public-demo" ? "HISTÓRICO DEMO" : "HISTÓRICO OFICIAL"}</span><span className={styles.historyWindow}>Últimos {history.days} días</span></div>
            <h2>{selectedBrand === "piwen" ? "Historial de precios vs competencia" : "Evolución de precios por categoría"}</h2>
            <p>{history.policy === "public-demo" ? "Serie demostrativa construida para visualizar cómo Super Precios seguirá la evolución de Piwén frente al benchmark. Al conectar capturas diarias, este mismo gráfico se alimenta con observaciones reales." : "El gráfico usa sólo observaciones guardadas desde los sitios oficiales. No mezcla precios de Rappi, Uber Eats ni locales spot."}</p>
          </div>
          <label>
            <span>Categoría</span>
            <select value={activeHistoryCategory} onChange={event => setHistoryCategory(event.target.value)}>
              {history.categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
        </div>
        <PriceHistoryChart history={history} category={activeHistoryCategory} subjectBrand={live!.subjectBrand} competitorBrand={live!.competitorBrand} />
      </article>}

      {qsr && live && <article className={styles.panel}>
        <div className={styles.panelTitle}><div><h2>Lectura ejecutiva</h2><p>Señales que Marketing, Pricing o Comercial puede convertir en acción.</p></div><span>MARKET PULSE</span></div>
        <div className={styles.insights}>
          <p><strong>Pack 6:</strong> {pack6 ? benchmarkSignal(pack6) : "Aún no existe un benchmark homologable."}</p>
          <p><strong>Docena:</strong> {pack12 ? benchmarkSignal(pack12) : "Aún no existe un benchmark homologable."}</p>
          <p><strong>24 unidades:</strong> {pack24 ? benchmarkSignal(pack24) : "Aún no existe un benchmark homologable."} El histórico permitirá detectar exactamente cuándo cambia esta relación.</p>
        </div>
      </article>}

      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Fuentes monitoreadas</h2><p>{officialOnly ? "Canales oficiales que alimentan precio actual e histórico." : "Canales activos que alimentan la evidencia y el benchmark."}</p></div><span className={styles.live}>OPERATIVO</span></div>
          <div className={styles.sourceList}>{payload.sources.map(s => <div className={styles.sourceRow} key={s.id}><div><strong>{s.retailer_name}</strong><span>{s.domain} · {s.source_type}</span></div><div><b>{s.listings}</b><small> observaciones</small></div><span className={s.last_status?.startsWith("ok")?styles.ok:styles.muted}>{s.last_status?.startsWith("ok") ? "OK" : s.last_status || "configurada"}</span></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Calidad de la última captura</h2><p>Trazabilidad del dato mostrado al cliente.</p></div></div>
          <div className={styles.runBox}>
            <strong>{run?.status || (live ? "verificada" : "sin corrida")}</strong>
            <p>{officialOnly ? "Cada corrida agrega una nueva observación. Si una fuente falla, se conserva la última captura válida sin inventar precios." : run ? `${run.sourcesSucceeded}/${run.sourcesAttempted} fuentes respondieron · ${run.listingsFound} precios persistidos.` : "La plataforma conserva la última observación válida."}</p>
            <dl><div><dt>Última observación</dt><dd>{dateOrDash(live?.observedAt || payload.summary.lastObservedAt)}</dd></div><div><dt>Política</dt><dd>{officialOnly ? "Sólo fuentes oficiales" : "Histórico"}</dd></div><div><dt>Mercado</dt><dd>{live?.market || payload.brand.countryCode}</dd></div></dl>
          </div>
        </article>
      </div>
    </>}

    {tab === "competition" && live && <>
      <article className={styles.liveHeader}>
        <div>
          <div className={styles.badgeRow}><span className={live.status === "unavailable" ? styles.partial : styles.live}>{pulseLabel(live)}</span>{officialOnly && <span className={styles.officialBadge}>OFFICIAL WEB VS OFFICIAL WEB</span>}</div>
          <h2>Competitive Market Pulse</h2>
          <p>{officialOnly ? "Benchmark construido con precios publicados en los canales web oficiales de ambas marcas." : `${live.category} · ${live.channel} · ${live.market}.`}</p>
        </div>
        <small>Última observación {dateOrDash(live.observedAt)}</small>
      </article>

      {live.benchmarks.length > 0 && <div className={styles.benchmarkGrid}>
        {live.benchmarks.map(benchmark => <article key={benchmark.key} className={styles.benchmarkCard}>
          <span>{benchmark.label}</span>
          <div className={styles.benchmarkPrices}>
            <div><small>{benchmark.subject.brand}</small><strong>{moneyOrDash(benchmark.subject.price)}</strong>{benchmark.subject.unitPrice && benchmark.subject.unitPrice !== benchmark.subject.price ? <em>{moneyOrDash(benchmark.subject.unitPrice)} / unidad</em> : null}</div>
            <div><small>{benchmark.competitor.brand}</small><strong>{moneyOrDash(benchmark.competitor.price)}</strong>{benchmark.competitor.unitPrice && benchmark.competitor.unitPrice !== benchmark.competitor.price ? <em>{moneyOrDash(benchmark.competitor.unitPrice)} / unidad</em> : null}</div>
          </div>
          <p><b>{benchmark.leader || "—"}</b> tiene el mejor precio · brecha {percent(benchmark.gapPct)}</p>
          <small className={styles.note}>{benchmark.note}</small>
        </article>)}
      </div>}

      <div className={styles.liveSourceGrid}>
        {live.sources.map(item => <article key={`${item.role}-${item.brand}`} className={styles.panel}>
          <div className={styles.sourceHero}>
            <div><span>{item.role === "brand" ? "MARCA ANALIZADA" : "COMPETIDOR DIRECTO"}</span><h2>{item.brand}</h2><p>{item.channel} · {item.domain || item.location}</p></div>
            <a href={item.url} target="_blank" rel="noreferrer">Abrir fuente oficial ↗</a>
          </div>
          <div className={styles.microKpis}>
            <div><span>Detectados</span><strong>{item.metrics.items}</strong></div>
            <div><span>Combos / promos</span><strong>{item.metrics.promoItems}</strong></div>
            <div><span>Precio entrada</span><strong>{moneyOrDash(item.metrics.lowestPrice)}</strong></div>
            <div><span>Fuente</span><strong>{officialOnly ? "Oficial" : item.channel}</strong></div>
          </div>
          {item.status === "degraded" && <div className={styles.sourceWarning}>La fuente no expuso precios en esta lectura. Se conserva la última captura válida. {item.error || ""}</div>}
          <div className={styles.liveItems}>
            {item.items.map(product => <div className={styles.liveItem} key={product.key}>
              <div><span>{product.marketCategory || product.category}</span><strong>{product.name}</strong>{product.units && product.units > 1 && product.unitPrice ? <small>{moneyOrDash(product.unitPrice)} por unidad{product.promoMechanic ? ` · ${product.promoMechanic}` : ""}</small> : product.promoMechanic ? <small>{product.promoMechanic}</small> : null}</div>
              <div className={styles.priceCell}><strong>{moneyOrDash(product.currentPrice)}</strong>{product.regularPrice ? <small>Ref. {moneyOrDash(product.regularPrice)}</small> : null}{product.discountPct ? <b>-{product.discountPct}%</b> : product.promotion ? <b>PROMO</b> : null}</div>
            </div>)}
            {!item.items.length && <div className={styles.emptyLive}>No hay precios válidos en la última captura.</div>}
          </div>
        </article>)}
      </div>
    </>}

    {tab === "copilot" && selectedBrand === "piwen" && <PiwenPricingCopilot/>}\n    {tab === "pricing-lab" && selectedBrand === "piwen" && <PiwenPricingLab/>}
    {tab === "promotions" && selectedBrand === "piwen" && <PiwenPromoSimulator/>}
    {tab === "packs" && selectedBrand === "piwen" && <PiwenPackArchitecture/>}
    {tab === "profitability" && selectedBrand === "piwen" && <PiwenChannelProfitability/>}

    {(tab === "products" || tab === "listings") && <div className={styles.filters}>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, marca o categoría…" />
      {tab === "listings" && <select value={source} onChange={e=>setSource(e.target.value)}><option value="">Todas las fuentes</option>{payload.sources.map(s=><option key={s.id} value={s.domain}>{s.retailer_name}</option>)}</select>}
    </div>}

    {tab === "products" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Catálogo monitoreado</h2><p>{officialOnly ? "Productos detectados desde los canales oficiales." : "Productos normalizados para análisis."}</p></div><span>{visibleProducts.length} productos</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>SKU / EAN</th><th>Categoría</th><th>Última detección</th></tr></thead><tbody>{visibleProducts.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.sku || p.ean || "—"}</td><td>{p.category || "—"}</td><td>{dateOrDash(p.lastSeenAt)}</td></tr>)}{!visibleProducts.length&&<tr><td colSpan={4} className={styles.empty}>Aún no hay productos capturados.</td></tr>}</tbody></table></div></article>}

    {tab === "retailers" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Fuentes de inteligencia</h2><p>{officialOnly ? "Sólo canales oficiales con precio publicado y trazable." : "Canales activos y trazables que alimentan el análisis."}</p></div></div><div className={styles.cards}>{payload.sources.map(s=><div className={styles.retailCard} key={s.id}><span>{s.source_type}</span><h3>{s.retailer_name}</h3><p>{s.domain}</p><dl><div><dt>Observaciones actuales</dt><dd>{s.listings}</dd></div><div><dt>Precio mín.</dt><dd>{moneyOrDash(s.min_price)}</dd></div><div><dt>Precio máx.</dt><dd>{moneyOrDash(s.max_price)}</dd></div></dl><small>Última captura: {dateOrDash(s.last_crawled_at)}</small>{s.last_error&&<em>{s.last_error}</em>}</div>)}</div></article>}

    {tab === "listings" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Evidencia de precios</h2><p>{officialOnly ? "Precio y timestamp persistidos desde los canales oficiales para auditoría e histórico." : "Precio, fuente y timestamp persistidos para auditoría."}</p></div><span>{visibleListings.length} registros</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Fuente / Marca</th><th>Precio</th><th>Stock</th><th>Observado</th></tr></thead><tbody>{visibleListings.map(l=><tr key={l.id}><td><a href={l.url} target="_blank" rel="noreferrer"><strong>{l.title}</strong></a></td><td>{l.source}<small className={styles.block}>{l.seller || l.domain}</small></td><td><strong>{moneyOrDash(l.currentPrice)}</strong>{l.regularPrice&&l.currentPrice&&l.regularPrice>l.currentPrice?<small className={styles.block}>Ref. {moneyOrDash(l.regularPrice)}</small>:null}</td><td>{l.inStock===null?"—":l.inStock?"Disponible":"Sin stock"}</td><td>{dateOrDash(l.observedAt)}</td></tr>)}{!visibleListings.length&&<tr><td colSpan={5} className={styles.empty}>Aún no hay evidencia persistida para esta vertical.</td></tr>}</tbody></table></div></article>}
  </section>;
}
