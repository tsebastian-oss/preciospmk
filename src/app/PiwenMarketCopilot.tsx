"use client";

import { useState, type ReactNode } from "react";
import styles from "./PiwenMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

type ChatMessage = { role: "user" | "assistant"; content: string };

function inlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  const separator = (line: string) => {
    const values = cells(line);
    return values.length > 0 && values.every(value => /^:?-{3,}:?$/.test(value.replace(/\s+/g, "")));
  };

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    if (line.startsWith("|") && index + 1 < lines.length && separator(lines[index + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push(<div className={styles.chatTableWrap} key={"t"+key++}><table className={styles.chatTable}>
        <thead><tr>{header.map((cell, i) => <th key={i}>{inlineMarkdown(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}>{header.map((_, i) => <td key={i}>{inlineMarkdown(row[i] ?? "")}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 className={styles.chatHeading} key={"h"+key++}>{inlineMarkdown(heading[2])}</h3>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul className={styles.chatList} key={"u"+key++}>{items.map((item, i) => <li key={i}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(<ol className={styles.chatList} key={"o"+key++}>{items.map((item, i) => <li key={i}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+[.)]\s+/.test(lines[index].trim()) &&
      !(lines[index].trim().startsWith("|") && index + 1 < lines.length && separator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p className={styles.chatParagraph} key={"p"+key++}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }

  return <div className={styles.chatMarkdown}>{blocks}</div>;
}

function modelLabel(value: string) {
  return value
    .replace(/^gpt-5\.6-sol$/i, "GPT-5.6 Sol")
    .replace(/^gpt-5\.6$/i, "GPT-5.6")
    .replace(/^gpt-/i, "GPT-");
}

export default function PiwenMarketCopilot() {
  const starter = "Hola. Soy el **MGP Pricing Copilot de Piwén**. Estoy conectado al mercado vigente de supermercados y a MercadoLibre. Puedo comparar marcas, retailers, formatos, $/kg, promociones y detectar oportunidades de precio.";
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: starter }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("AI");
  const [observedAt, setObservedAt] = useState<string | null>(null);

  const suggestions = [
    "¿Dónde está Piwén más caro vs mercado?",
    "Compara Piwén vs Alto La Cruz y Millantú",
    "¿Qué retailer tiene precios más bajos?",
    "¿Qué oportunidades ves en MercadoLibre?",
  ];

  async function ask(question: string) {
    const clean = question.trim();
    if (!clean || loading) return;
    const next = [...messages, { role: "user" as const, content: clean }];
    setMessages(next);
    setInput("");
    setLoading(true);
    trackUsageEvent("ai_query", { module: "piwen-market", metadata: { assistant: "pricing-copilot" } });

    try {
      const response = await fetch("/api/piwen-pricing-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ messages: next.slice(-14) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.answer) throw new Error(data?.error || "No fue posible consultar el copiloto.");
      setMessages(current => [...current, { role: "assistant", content: String(data.answer) }]);
      if (typeof data.model === "string") setModel(modelLabel(data.model));
      if (typeof data.dataObservedAt === "string") setObservedAt(data.dataObservedAt);
    } catch (error) {
      setMessages(current => [...current, {
        role: "assistant",
        content: `No pude responder esta consulta en este momento. **${error instanceof Error ? error.message : "Intenta nuevamente."}**`,
      }]);
    } finally {
      setLoading(false);
    }
  }

  return <section className={styles.copilotShell}>
    <div className={styles.copilotHero}>
      <div>
        <span>MGP AI PRICING COPILOT</span>
        <h2>Pregunta al mercado</h2>
        <p>Respuestas con contexto vigente de Piwén, competencia, supermercados y MercadoLibre.</p>
      </div>
      <div className={styles.copilotStatus}>
        <i />
        <div><strong>{model}</strong><small>{observedAt ? `Datos: ${new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(observedAt))}` : "Contexto de mercado conectado"}</small></div>
      </div>
    </div>

    <div className={styles.copilotLayout}>
      <aside className={styles.copilotSuggestions}>
        <span>PREGUNTAS SUGERIDAS</span>
        {suggestions.map(item => <button key={item} onClick={() => void ask(item)} disabled={loading}>{item}<b>→</b></button>)}
        <div className={styles.copilotScope}>
          <strong>Qué puede analizar</strong>
          <p>Precio promedio, $/kg, promociones, retailer, marca, familia, formato y diferencias entre supermercado, Piwén.cl y MercadoLibre.</p>
        </div>
      </aside>

      <div className={styles.chatPanel}>
        <div className={styles.chatMessages}>
          {messages.map((message, index) => <div key={index} className={message.role === "user" ? styles.userBubble : styles.assistantBubble}>
            <span>{message.role === "user" ? "TÚ" : "MGP PRICING COPILOT"}</span>
            {message.role === "assistant" ? <Markdown content={message.content}/> : <p>{message.content}</p>}
          </div>)}
          {loading && <div className={styles.assistantBubble}><span>MGP PRICING COPILOT</span><p className={styles.thinking}>Analizando precios, formatos y competencia…</p></div>}
        </div>
        <form className={styles.chatComposer} onSubmit={event => { event.preventDefault(); void ask(input); }}>
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(input);
              }
            }}
            rows={2}
            placeholder="Ej: compara el precio por kilo de almendras entre Piwén, Alto La Cruz y las principales marcas…"
          />
          <button type="submit" disabled={loading || !input.trim()}>{loading ? "Analizando…" : "Preguntar ↗"}</button>
        </form>
      </div>
    </div>
  </section>;
}
