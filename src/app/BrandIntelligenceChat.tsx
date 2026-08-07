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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  brand?: string | null;
  meta?: { skus?: number; retailers?: number; lastObservedAt?: string | null };
  ai?: boolean;
};

type ChatResponse = {
  answer?: string;
  brand?: string | null;
  ai?: boolean;
  warning?: string;
  error?: string;
  candidates?: Array<{ brand: string; products: number }>;
  data?: {
    current?: { summary?: { skus?: number; retailers?: number; lastObservedAt?: string | null } };
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

      const summary = data.data?.current?.summary;
      setMessages((current) => [...current, {
        id: id(),
        role: "assistant",
        content: data.answer!,
        brand: data.brand,
        ai: data.ai,
        meta: summary ? { skus: summary.skus, retailers: summary.retailers, lastObservedAt: summary.lastObservedAt } : undefined,
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
        {messages.map((message) => <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}>
          {message.role === "assistant" && <div className={styles.avatar}>AI</div>}
          <div className={styles.bubble}>
            {message.brand && <div className={styles.brandTag}><span>●</span>{message.brand}</div>}
            <div className={styles.answer}>{message.content}</div>
            {message.meta && <footer>
              {message.meta.skus !== undefined && <span>{new Intl.NumberFormat("es-CL").format(message.meta.skus)} SKU</span>}
              {message.meta.retailers !== undefined && <span>{message.meta.retailers} cadenas</span>}
              {message.meta.lastObservedAt && <span>Datos al {displayDate(message.meta.lastObservedAt)}</span>}
              {message.ai === false && <span>Respuesta de respaldo</span>}
            </footer>}
          </div>
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
