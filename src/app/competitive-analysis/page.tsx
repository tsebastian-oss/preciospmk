"use client";

import { type FormEvent, useState } from "react";
import styles from "./competitive-analysis.module.css";

type Product = {
  id: string;
  supermarket: string;
  name: string;
  brand: string | null;
  category: string | null;
  offer_price: number | string;
};

type Competitor = Product & {
  similarity: number;
  relationship: "equivalent" | "direct_competitor" | "substitute";
  reasons: string[];
  price_gap: number;
};

type Analysis = {
  target: Product;
  competitors: Competitor[];
  metrics: {
    marketAverage: number;
    marketMin: number;
    marketMax: number;
    referencePrice: number;
    position: { code: string; label: string; diffPct: number };
    rank: number;
    totalRanked: number;
    recommendedMin: number;
    recommendedMax: number;
    gapVsCheapest: number;
    gapVsCheapestPct: number;
  };
  explanation: string;
};

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const relationshipLabel: Record<Competitor["relationship"], string> = {
  equivalent: "Equivalente",
  direct_competitor: "Competidor directo",
  substitute: "Sustituto cercano",
};

export default function CompetitiveAnalysisPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setAnalysis(null);
    try {
      const response = await fetch(`/api/competitive-analysis?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible buscar productos");
      setResults(payload.searchResults ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de búsqueda");
    } finally {
      setLoading(false);
    }
  }

  async function analyze(productId: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/competitive-analysis?productId=${encodeURIComponent(productId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible construir el set competitivo");
      setAnalysis(payload as Analysis);
      setResults([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de análisis");
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <span>MGP RETAIL INTELLIGENCE</span>
        <h1>Competitive Pricing Intelligence</h1>
        <p>Selecciona un producto y detecta automáticamente equivalentes, competidores directos y sustitutos comparables.</p>
      </div>
      <a href="/">Volver al dashboard</a>
    </header>

    <form className={styles.search} onSubmit={search}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o marca" />
      <button disabled={loading}>{loading ? "Procesando…" : "Buscar"}</button>
    </form>

    {error && <div className={styles.error}>{error}</div>}

    {results.length > 0 && <section className={styles.results}>
      <h2>Selecciona el producto de referencia</h2>
      <div>{results.map((product) => <button key={product.id} type="button" onClick={() => analyze(product.id)}>
        <span><strong>{product.name}</strong><small>{product.supermarket} · {product.brand || "Sin marca"}</small></span>
        <b>{money.format(Number(product.offer_price))}</b>
      </button>)}</div>
    </section>}

    {analysis && <>
      <section className={styles.heroGrid}>
        <article className={styles.targetCard}>
          <span>PRODUCTO ANALIZADO</span>
          <h2>{analysis.target.name}</h2>
          <p>{analysis.target.supermarket} · {analysis.target.brand || "Sin marca"}</p>
          <strong>{money.format(analysis.metrics.referencePrice)}</strong>
        </article>
        <article className={styles.positionCard}>
          <span>POSICIÓN DE PRECIO</span>
          <strong>{analysis.metrics.position.diffPct >= 0 ? "+" : ""}{analysis.metrics.position.diffPct.toFixed(1)}%</strong>
          <h2>{analysis.metrics.position.label}</h2>
          <p>Frente al promedio competitivo</p>
        </article>
        <article className={styles.recommendationCard}>
          <span>RANGO RECOMENDADO</span>
          <strong>{money.format(analysis.metrics.recommendedMin)} – {money.format(analysis.metrics.recommendedMax)}</strong>
          <p>Promedio de mercado ±5%</p>
        </article>
      </section>

      <section className={styles.metrics}>
        <article><span>Promedio</span><strong>{money.format(analysis.metrics.marketAverage)}</strong></article>
        <article><span>Mínimo</span><strong>{money.format(analysis.metrics.marketMin)}</strong></article>
        <article><span>Máximo</span><strong>{money.format(analysis.metrics.marketMax)}</strong></article>
        <article><span>Ranking</span><strong>{analysis.metrics.rank || "—"} / {analysis.metrics.totalRanked}</strong></article>
      </section>

      <section className={styles.aiCard}>
        <div className={styles.sectionHead}><span>AI EXPLANATION</span><h2>Lectura inteligente</h2></div>
        <p>{analysis.explanation}</p>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.sectionHead}><span>COMPETITIVE SET</span><h2>Competidores detectados</h2></div>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>Producto</th><th>Cadena</th><th>Relación</th><th>Confianza</th><th>Precio</th><th>Brecha</th></tr></thead>
          <tbody>{analysis.competitors.map((item) => <tr key={item.id}>
            <td><strong>{item.name}</strong><br /><small>{item.reasons.join(" · ")}</small></td>
            <td>{item.supermarket}</td>
            <td>{relationshipLabel[item.relationship]}</td>
            <td>{item.similarity.toFixed(1)}%</td>
            <td>{money.format(Number(item.offer_price))}</td>
            <td>{item.price_gap > 0 ? "+" : ""}{money.format(item.price_gap)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </>}
  </main>;
}
