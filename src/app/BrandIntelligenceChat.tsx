"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import styles from "./BrandIntelligenceChat.module.css";
import historyStyles from "./BrandIntelligenceHistory.module.css";

type ChatFilters = {
  retailerType: "all" | "supermarket" | "department_store" | "pharmacy";
  supermarket: string;
  category: string;
  brand: string;
  query: string;
  stock: "all" | "in" | "out";
  period: number;
};

type StructuredAnalysis = {
  headline: string;
  summary: string;
  insights: Array<{ title: string; detail: string }>;
  actions: string[];
};

type BrandSummary = {
  skus?: number | null;
  retailers?: number | null;
  stockKnown?: number | null;
  inStock?: number | null;
  availabilityPct?: number | null;
  offers?: number | null;
  offerPct?: number | null;
  priceComparable?: boolean | null;
  averagePrice?: number | null;
  medianPrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  lastObservedAt?: string | null;
};

type BrandSource = {
  product?: string;
  category?: string | null;
  supermarkets?: number;
  bestPrice?: number;
  highestPrice?: number;
  savingsPct?: number;
  bestRetailer?: string | null;
  listings?: Array<{ retailer?: string; price?: number; inStock?: boolean }>;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  brand?: string | null;
  summary?: BrandSummary;
  analysis?: StructuredAnalysis;
  sources?: BrandSource[];
  model?: string | null;
  ai?: boolean;
};

type ChatResponse = {
  answer?: string;
  analysis?: StructuredAnalysis;
  brand?: string | null;
  model?: string | null;
  ai?: boolean;
  warning?: string;
  error?: string;
  conversationId?: string;
  conversationTitle?: string;
  candidates?: Array<{ brand: string; products: number }>;
  data?: { current?: { summary?: BrandSummary }; priceMatches?: BrandSource[] };
};

type Conversation = {
  id: string;
  title: string;
  last_brand?: string | null;
  created_at: string;
  updated_at: string;
};

type StoredMessage = {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  brand?: string | null;
  ai?: boolean | null;
  payload?: {
    analysis?: StructuredAnalysis | null;
    summary?: BrandSummary | null;
    sources?: BrandSource[] | null;
    model?: string | null;
  } | null;
};

const EXAMPLES = [
  "¿Cómo está Coca-Cola en lata hoy?",
  "¿Qué te llama la atención de OMO?",
  "Explícame la situación de Nivea sin lenguaje técnico",
  "¿Dónde está más barata Becker y qué tan confiable es la comparación?",
];

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hola, soy MGP Intelligence, potenciado por OpenAI Sol. Puedes preguntarme por precios, surtido, stock, promociones o evolución de una marca y seguir conversando sin repetir todo el contexto. Mis respuestas se apoyan en los datos diarios monitoreados por MGP.",
  model: "gpt-5.6-sol",
  ai: true,
};

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scopeText(filters: ChatFilters) {
  const parts: string[] = [];
  if (filters.retailerType !== "all") parts.push(filters.retailerType === "supermarket" ? "Supermercados" : filters.retailerType === "pharmacy" ? "Farmacias" : "Multitiendas");
  if (filters.supermarket) parts.push(filters.supermarket);
  if (filters.category) parts.push(filters.category);
  if (filters.brand) parts.push(filters.brand);
  if (filters.stock !== "all") parts.push(filters.stock === "in" ? "Con stock" : "Sin stock");
  parts.push(`${filters.period} días`);
  return parts.join(" · ");
}

function displayDate(value?: string | null) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "";
  }
}

function historyDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(date);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function money(value?: number | null) {
  if (!finiteNumber(value)) return "Sin dato";
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Number(value))}`;
}

function availability(summary?: BrandSummary) {
  if (finiteNumber(summary?.availabilityPct)) return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(summary.availabilityPct)}%`;
  if (!finiteNumber(summary?.skus) || summary.skus <= 0 || !finiteNumber(summary.inStock)) return "Sin dato";
  return `${Math.round((summary.inStock / summary.skus) * 100)}%`;
}

function inlineText(value: string) {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>,
  );
}

function ConversationalAnswer({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/).filter(Boolean);
  return <div className={styles.answer}>{blocks.map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineText(line.replace(/^[-*]\s+/, ""))}</li>)}</ul>;
    }
    if (lines.length && lines.every((line) => /^\d+[.)]\s+/.test(line))) {
      return <ol key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineText(line.replace(/^\d+[.)]\s+/, ""))}</li>)}</ol>;
    }
    if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
      return <h3 key={index}>{inlineText(lines[0].replace(/^#{1,3}\s+/, ""))}</h3>;
    }
    return <p key={index}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br/>}{inlineText(line)}</Fragment>)}</p>;
  })}</div>;
}

function SourceDetails({ sources }: { sources?: BrandSource[] }) {
  if (!sources?.length) return null;
  return <details className={styles.provenance}>
    <summary>Ver comparables usados en el análisis ({sources.length})</summary>
    <div className={styles.provenanceTable}><table><thead><tr><th>Producto comparable</th><th>Mejor retailer</th><th>Mejor precio</th><th>Precio máx.</th><th>Brecha</th><th>Cadenas</th></tr></thead><tbody>{sources.slice(0, 6).map((source, index) => <tr key={(source.product || "source") + "-" + index}><td><strong>{source.product || "Comparable"}</strong><small>{source.category || ""}</small></td><td>{source.bestRetailer || "—"}</td><td>{money(source.bestPrice)}</td><td>{money(source.highestPrice)}</td><td>{source.savingsPct !== undefined ? Number(source.savingsPct).toFixed(1) + "%" : "—"}</td><td>{source.supermarkets ?? source.listings?.length ?? "—"}</td></tr>)}</tbody></table></div>
    <p>Estos datos provienen del alcance y período activos. Sol interpreta la información; los precios y brechas se calculan desde la base monitoreada.</p>
  </details>;
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className={styles.kpi}>
    <span>{label}</span>
    <strong>{value}</strong>
    {detail && <small>{detail}</small>}
  </div>;
}

function ExecutiveAnswer({ message }: { message: ChatMessage }) {
  const analysis = message.analysis!;
  const summary = message.summary;
  const hasSku = finiteNumber(summary?.skus);
  const hasRetailers = finiteNumber(summary?.retailers);
  const hasStock = finiteNumber(summary?.inStock) && finiteNumber(summary?.stockKnown);
  const hasOffers = finiteNumber(summary?.offers);
  const hasPriceRange = finiteNumber(summary?.minPrice) && finiteNumber(summary?.maxPrice);
  const hasComparablePrice = summary?.priceComparable === true && finiteNumber(summary.medianPrice);
  return <div className={styles.executiveCard}>
    <div className={styles.executiveTop}>
      <div>
        {message.brand && <div className={styles.brandTag}><span>●</span>{message.brand}</div>}
        <h3>{analysis.headline}</h3>
        <p>{analysis.summary}</p>
      </div>
    </div>

    {summary && <div className={styles.kpiGrid}>
      <Kpi label="SKU vigentes" value={hasSku ? new Intl.NumberFormat("es-CL").format(summary.skus!) : "Sin dato"} detail={hasRetailers ? `${summary.retailers} cadenas` : undefined}/>
      <Kpi label="Disponibilidad" value={availability(summary)} detail={hasStock ? `${summary.inStock} de ${summary.stockKnown} con stock informado` : undefined}/>
      <Kpi label="Precio comparable" value={hasComparablePrice ? money(summary.medianPrice) : "No comparable"} detail={hasComparablePrice && hasPriceRange ? `${money(summary.minPrice)} – ${money(summary.maxPrice)}` : "Especifica tamaño y si es unidad o pack."}/>
      <Kpi label="Ofertas detectadas" value={hasOffers ? new Intl.NumberFormat("es-CL").format(summary.offers!) : "Sin dato"} detail={hasOffers ? "productos con precio regular y promocional" : undefined}/>
    </div>}

    <div className={styles.analysisColumns}>
      <section>
        <div className={styles.sectionLabel}>Qué está pasando</div>
        <div className={styles.insightList}>
          {analysis.insights.map((item, index) => <div className={styles.insight} key={`${item.title}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{item.title}</strong><p>{item.detail}</p></div>
          </div>)}
        </div>
      </section>

      {analysis.actions.length > 0 && <section className={styles.actionsPanel}>
        <div className={styles.sectionLabel}>Qué haría</div>
        <div className={styles.actionList}>
          {analysis.actions.map((action, index) => <div className={styles.action} key={`${action}-${index}`}>
            <b>{index + 1}</b><span>{action}</span>
          </div>)}
        </div>
      </section>}
    </div>

    <footer className={styles.executiveFooter}>
      {summary?.lastObservedAt && <span>Datos al {displayDate(summary.lastObservedAt)}</span>}
      {message.ai === false && <span>Respuesta de respaldo</span>}
    </footer>
    <SourceDetails sources={message.sources}/>
  </div>;
}

export default function BrandIntelligenceChat({ filters }: { filters: ChatFilters }) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scope = useMemo(() => scopeText(filters), [filters]);

  async function loadHistory() {
    try {
      const response = await fetch("/api/brand-chat/history", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible cargar el historial.");
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void loadHistory(); }, []);

  async function openConversation(conversation: Conversation) {
    if (loading || conversationLoading || conversation.id === conversationId) return;
    setConversationLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/brand-chat/history?id=${encodeURIComponent(conversation.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible abrir la conversación.");
      const stored = (Array.isArray(data.messages) ? data.messages : []) as StoredMessage[];
      const restored: ChatMessage[] = stored.map((message) => ({
        id: String(message.id),
        role: message.role,
        content: message.content,
        brand: message.brand ?? null,
        ai: message.ai ?? undefined,
        analysis: message.payload?.analysis ?? undefined,
        summary: message.payload?.summary ?? undefined,
        sources: message.payload?.sources ?? undefined,
        model: message.payload?.model ?? undefined,
      }));
      setConversationId(conversation.id);
      setMessages(restored.length ? restored : [WELCOME]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible abrir la conversación.");
    } finally {
      setConversationLoading(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([WELCOME]);
    setInput("");
    setError("");
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function deleteConversation(targetId: string) {
    try {
      const response = await fetch(`/api/brand-chat/history?id=${encodeURIComponent(targetId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible eliminar la conversación.");
      if (conversationId === targetId) newConversation();
      setConversations((current) => current.filter((item) => item.id !== targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible eliminar la conversación.");
    }
  }

  async function ask(question: string) {
    const clean = question.trim();
    if (!clean || loading) return;

    const userMessage: ChatMessage = { id: id(), role: "user", content: clean };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/brand-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messages: next.filter((item) => item.id !== "welcome").map(({ role, content, brand }) => ({ role, content, brand })),
          filters,
        }),
      });
      const data = await response.json() as ChatResponse;
      if (data.conversationId) setConversationId(data.conversationId);
      if (!response.ok || !data.answer) {
        void loadHistory();
        throw new Error(data.error || "No fue posible generar el análisis.");
      }

      setMessages((current) => [...current, {
        id: id(),
        role: "assistant",
        content: data.answer!,
        brand: data.brand,
        ai: data.ai,
        analysis: data.analysis,
        summary: data.data?.current?.summary,
        sources: data.data?.priceMatches ?? [],
        model: data.model,
      }]);
      void loadHistory();
      if (data.warning) setError(data.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible consultar el analista de marca.");
    } finally {
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div className={styles.heroIcon}>✦</div>
      <div>
        <span>POWERED BY OPENAI SOL</span>
        <h2>MGP Intelligence</h2>
        <p>Conversa naturalmente con tus datos diarios de precios, surtido, stock y promociones. El módulo recuerda el contexto del hilo.</p>
      </div>
      <div className={styles.scopeBox}>
        <small>ALCANCE ACTUAL</small>
        <strong>{scope}</strong>
        <span>Los filtros globales se aplican automáticamente</span>
      </div>
    </div>

    <div className={historyStyles.workspace}>
      <aside className={historyStyles.historyPanel}>
        <div className={historyStyles.historyHeader}>
          <div><span>HISTORIAL</span><strong>Conversaciones</strong></div>
          <button onClick={newConversation} title="Nueva conversación" aria-label="Nueva conversación">＋</button>
        </div>
        <button className={historyStyles.newChat} onClick={newConversation}><span>✦</span>Nueva conversación</button>
        <div className={historyStyles.historyList}>
          {historyLoading && <div className={historyStyles.historyEmpty}>Cargando historial…</div>}
          {!historyLoading && conversations.length === 0 && <div className={historyStyles.historyEmpty}>Tus conversaciones se guardarán aquí automáticamente.</div>}
          {conversations.map((conversation) => <button
            key={conversation.id}
            className={`${historyStyles.historyItem} ${conversation.id === conversationId ? historyStyles.activeHistoryItem : ""}`}
            onClick={() => void openConversation(conversation)}
          >
            <span className={historyStyles.historyIcon}>✦</span>
            <span className={historyStyles.historyCopy}>
              <strong>{conversation.title}</strong>
              <small>{conversation.last_brand || "MGP Intelligence"} · {historyDate(conversation.updated_at)}</small>
            </span>
            <span
              className={historyStyles.deleteHistory}
              role="button"
              tabIndex={0}
              title="Eliminar conversación"
              onClick={(event) => { event.stopPropagation(); void deleteConversation(conversation.id); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); void deleteConversation(conversation.id); } }}
            >×</span>
          </button>)}
        </div>
      </aside>

      <div className={styles.chatCard}>
        <div className={styles.messages}>
          {conversationLoading && <div className={historyStyles.loadingConversation}>Abriendo conversación…</div>}
          {!conversationLoading && messages.map((message) => <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant} ${message.analysis ? styles.executiveMessage : ""}`}>
            {message.role === "assistant" && <div className={styles.avatar}>Sol</div>}
            {message.analysis ? <ExecutiveAnswer message={message}/> : <div className={styles.bubble}>
              {message.brand && <div className={styles.brandTag}><span>●</span>{message.brand}</div>}
              <ConversationalAnswer text={message.content}/>
              <SourceDetails sources={message.sources}/>
              {message.summary && <footer>
                {finiteNumber(message.summary.skus) && <span>{new Intl.NumberFormat("es-CL").format(message.summary.skus)} SKU</span>}
                {finiteNumber(message.summary.retailers) && <span>{message.summary.retailers} cadenas</span>}
                {message.summary.lastObservedAt && <span>Datos al {displayDate(message.summary.lastObservedAt)}</span>}
                {message.model && <span>{/^gpt-5\.6(?:-sol)?$/.test(message.model) ? "OpenAI Sol" : "OpenAI"}</span>}
                {message.ai === false && <span>Respuesta de respaldo</span>}
              </footer>}
            </div>}
          </article>)}
          {loading && <article className={`${styles.message} ${styles.assistant}`}><div className={styles.avatar}>Sol</div><div className={`${styles.bubble} ${styles.thinking}`}><i/><i/><i/><span>Revisando los datos y pensando la respuesta…</span></div></article>}
        </div>

        {messages.length === 1 && !conversationLoading && <div className={styles.examples}>
          <span>Prueba preguntando</span>
          <div>{EXAMPLES.map((example) => <button key={example} onClick={() => void ask(example)}>{example}</button>)}</div>
        </div>}

        {error && <div className={styles.error}>{error}<button onClick={() => setError("")}>×</button></div>}

        <form className={styles.composer} onSubmit={submit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (input.trim()) void ask(input);
              }
            }}
            placeholder="Pregúntame algo o continúa la conversación…"
            rows={2}
            maxLength={2500}
            disabled={conversationLoading}
          />
          <button type="submit" disabled={loading || conversationLoading || !input.trim()} aria-label="Enviar pregunta">↑</button>
        </form>
        <div className={styles.composerFooter}>
          <span>OpenAI Sol conversa sobre datos calculados por MGP. Las conversaciones se guardan de forma privada en tu cuenta.</span>
          {messages.length > 1 && <button onClick={newConversation}>Nueva conversación</button>}
        </div>
      </div>
    </div>
  </section>;
}
