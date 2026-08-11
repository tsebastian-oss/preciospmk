"use client";

import { FormEvent, Fragment, useMemo, useState } from "react";
import styles from "./DashboardContextChat.module.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
export type DashboardAiContext = {
  query: string | null;
  brand: string | null;
  category: string | null;
  retailers: string[];
  days: number;
  scope: "product" | "brand" | "category" | "market";
};

type Props = {
  filters: { retailer: string; category: string; brand: string; days: number };
  activeContext: DashboardAiContext | null;
  onContextChange: (context: DashboardAiContext | null) => void;
};

type ChatResponse = {
  answer?: string;
  model?: string;
  toolsUsed?: string[];
  dashboardContext?: DashboardAiContext | null;
  error?: string;
};

const QUICK = [
  "¿Cómo evolucionó Coca-Cola Zero lata?",
  "¿Qué promociones destacan hoy?",
  "Compara esta categoría entre retailers",
];

function inlineText(value: string) {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>,
  );
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isDivider(line: string) {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function Answer({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (!line) { index += 1; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={`h-${key++}`}>{inlineText(heading[2])}</h4>);
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isDivider(lines[index + 1] ?? "")) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        rows.push(tableCells(lines[index] ?? ""));
        index += 1;
      }
      blocks.push(<div className={styles.tableWrap} key={`t-${key++}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineText(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inlineText(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${key++}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item)}</li>)}</ul>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] ?? "").trim();
      if (!next || /^#{1,6}\s+/.test(next) || /^[-*+]\s+/.test(next) || (next.includes("|") && index + 1 < lines.length && isDivider(lines[index + 1] ?? ""))) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`p-${key++}`}>{paragraph.map((item, itemIndex) => <Fragment key={itemIndex}>{itemIndex > 0 && <br/>}{inlineText(item)}</Fragment>)}</p>);
  }
  return <div className={styles.answer}>{blocks}</div>;
}

export default function DashboardContextChat({ filters, activeContext, onContextChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Pregúntame por un producto, marca, categoría o retailer. Cuando detecte un contexto concreto, actualizaré también los gráficos del dashboard con datos de ClickHouse." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("GPT-5.6 Sol");
  const [error, setError] = useState("");

  const contextLabel = useMemo(() => {
    if (!activeContext) return "Mercado completo";
    if (activeContext.query) return activeContext.query;
    if (activeContext.brand) return activeContext.brand;
    if (activeContext.category) return activeContext.category;
    return "Mercado completo";
  }, [activeContext]);

  async function send(question: string) {
    const clean = question.trim();
    if (!clean || loading) return;
    const userMessage: ChatMessage = { role: "user", content: clean };
    const history = [...messages, userMessage].slice(-12);
    setMessages(history);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/clickhouse-dashboard-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, filters: { supermarket: filters.retailer, category: filters.category, brand: filters.brand, period: filters.days } }),
        cache: "no-store",
      });
      const data = await response.json() as ChatResponse;
      if (!response.ok || !data.answer) throw new Error(data.error || "No fue posible responder.");
      setMessages((current) => [...current, { role: "assistant", content: data.answer as string }].slice(-14));
      if (data.model) setModel(data.model);
      if (data.dashboardContext) onContextChange(data.dashboardContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible responder.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return <article className={styles.chatCard}>
    <header className={styles.header}>
      <div><span>MGP INTELLIGENCE</span><h2>Analista conversacional</h2><p>GPT-5.6 + herramientas ClickHouse</p></div>
      <div className={styles.status}><i/><strong>{model}</strong></div>
    </header>
    <div className={styles.contextBar}>
      <span>Contexto del dashboard</span><strong>{contextLabel}</strong>
      {activeContext && <button onClick={() => onContextChange(null)}>Restablecer</button>}
    </div>
    <div className={styles.messages}>
      {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? styles.user : styles.assistant}>
        {message.role === "assistant" ? <Answer text={message.content}/> : <p>{message.content}</p>}
      </div>)}
      {loading && <div className={`${styles.assistant} ${styles.thinking}`}><i/><span>Consultando ClickHouse y analizando…</span></div>}
    </div>
    {error && <div className={styles.error}>{error}</div>}
    <div className={styles.quick}>{QUICK.map((item) => <button key={item} onClick={() => void send(item)} disabled={loading}>{item}</button>)}</div>
    <form className={styles.composer} onSubmit={submit}>
      <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ej: Muéstrame Coca-Cola Zero lata y compárala entre cadenas…" rows={2}/>
      <button type="submit" disabled={loading || !input.trim()}>{loading ? "…" : "Enviar ↗"}</button>
    </form>
  </article>;
}
