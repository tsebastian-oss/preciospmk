"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import styles from "./BrandIntelligenceChat.module.css";

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
  skus?: number;
  retailers?: number;
  inStock?: number;
  offers?: number;
  averagePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  lastObservedAt?: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  brand?: string | null;
  summary?: BrandSummary;
  analysis?: StructuredAnalysis;
  ai?: boolean;
};

type ChatResponse = {
  answer?: string;
  analysis?: StructuredAnalysis;
  brand?: string | null;
  ai?: boolean;
  warning?: string;
  error?: string;
  candidates?: Array<{ brand: string; products: number }>;
  data?: {
    current?: { summary?: BrandSummary };
  };
};

const EXAMPLES = [
  "¿Cómo está Becker?",
  "Analiza OMO y dime qué te llama la atención",
  "¿En qué cadenas está mejor posicionada Nivea?",
  "¿Qué oportunidades de precio ves para Coca-Cola?",
];

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

function money(value?: number) {
  if (!Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Number(value))}`;
}

function availability(summary?: BrandSummary) {
  if (!summary?.skus || summary.inStock === undefined) return "—";
  return `${Math.round((summary.inStock / summary.skus) * 100)}%`;
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
  return <div className={styles.executiveCard}>
    <div className={styles.executiveTop}>
      <div>
        {message.brand && <div className={styles.brandTag}><span>●</span>{message.brand}</div>}
        <h3>{analysis.headline}</h3>
        <p>{analysis.summary}</p>
      </div>
    </div>

    {summary && <div className={styles.kpiGrid}>
      <Kpi label="SKU monitoreados" value={summary.skus !== undefined ? new Intl.NumberFormat("es-CL").format(summary.skus) : "—"} detail={summary.retailers !== undefined ? `${summary.retailers} cadenas` : undefined}/>
      <Kpi label="Disponibilidad" value={availability(summary)} detail={summary.inStock !== undefined && summary.skus !== undefined ? `${summary.inStock} de ${summary.skus} con stock` : undefined}/>
      <Kpi label="Precio promedio" value={money(summary.averagePrice)} detail={summary.minPrice !== undefined && summary.maxPrice !== undefined ? `${money(summary.minPrice)} – ${money(summary.maxPrice)}` : undefined}/>
      <Kpi label="En oferta" value={summary.offers !== undefined ? new Intl.NumberFormat("es-CL").format(summary.offers) : "—"} detail="productos con promoción"/>
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
  </div>;
}

export default function BrandIntelligenceChat({ filters }: { filters: ChatFilters }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Pregúntame por cualquier marca presente en la base. Puedo analizar su surtido, cadenas donde aparece, stock, precios, promociones, evolución y brechas competitivas usando los datos monitoreados por MGP.",
      ai: true,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scope = useMemo(() => scopeText(filters), [filters]);

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
          messages: next.filter((item) => item.id !== "welcome").map(({ role, content }) => ({ role, content })),
          filters,
        }),
      });
      const data = await response.json() as ChatResponse;
      if (!response.ok || !data.answer) throw new Error(data.error || "No fue posible generar el análisis.");

      setMessages((current) => [...current, {
        id: id(),
        role: "assistant",
        content: data.answer!,
        brand: data.brand,
        ai: data.ai,
        analysis: data.analysis,
        summary: data.data?.current?.summary,
      }]);
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
        <span>MGP · OPENAI</span>
        <h2>Brand Intelligence AI</h2>
        <p>Pregunta en lenguaje natural y obtén respuestas basadas en la información real de precios y surtido de la plataforma.</p>
      </div>
      <div className={styles.scopeBox}>
        <small>ALCANCE ACTUAL</small>
        <strong>{scope}</strong>
        <span>Los filtros globales se aplican automáticamente</span>
      </div>
    </div>

    <div className={styles.chatCard}>
      <div className={styles.messages}>
        {messages.map((message) => <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant} ${message.analysis ? styles.executiveMessage : ""}`}>
          {message.role === "assistant" && <div className={styles.avatar}>AI</div>}
          {message.analysis ? <ExecutiveAnswer message={message}/> : <div className={styles.bubble}>
            {message.brand && <div className={styles.brandTag}><span>●</span>{message.brand}</div>}
            <div className={styles.answer}>{message.content}</div>
            {message.summary && <footer>
              {message.summary.skus !== undefined && <span>{new Intl.NumberFormat("es-CL").format(message.summary.skus)} SKU</span>}
              {message.summary.retailers !== undefined && <span>{message.summary.retailers} cadenas</span>}
              {message.summary.lastObservedAt && <span>Datos al {displayDate(message.summary.lastObservedAt)}</span>}
              {message.ai === false && <span>Respuesta de respaldo</span>}
            </footer>}
          </div>}
        </article>)}
        {loading && <article className={`${styles.message} ${styles.assistant}`}><div className={styles.avatar}>AI</div><div className={`${styles.bubble} ${styles.thinking}`}><i/><i/><i/><span>Analizando la base y preparando respuesta…</span></div></article>}
      </div>

      {messages.length === 1 && <div className={styles.examples}>
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
          placeholder="Ej: Quiero saber cómo está Becker y dónde tiene las mayores diferencias de precio…"
          rows={2}
          maxLength={2500}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Enviar pregunta">↑</button>
      </form>
      <div className={styles.composerFooter}>
        <span>Las respuestas se construyen con datos de la plataforma; no se infieren ventas ni market share si no están disponibles.</span>
        {messages.length > 1 && <button onClick={() => { setMessages(messages.slice(0, 1)); setError(""); }}>Nueva conversación</button>}
      </div>
    </div>
  </section>;
}
