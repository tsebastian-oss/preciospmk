"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import styles from "./competitive-analysis.module.css";

type Product = {
  id: string;
  supermarket: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | string | null;
  offer_price: number | string;
  in_stock: boolean;
};

type Competitor = Product & {
  similarity: number;
  relationship: "equivalent" | "direct_competitor" | "substitute";
  reasons: string[];
  price_gap: number;
  price_gap_pct: number;
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

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const relationshipLabel = {
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

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setAnalysis(null);
    try {
      const response = await fetch(`/api/competitive-analysis?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible buscar productos");
      setResults(payload.searchResults ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de búsqueda");
    } finally { setLoading(false); }
  }

  async function analyze(productId: string) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/competitive-analysis?productId=${encodeURIComponent(productId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible construir el set competitivo");
      setAnalysis(payload); setResults([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de análisis");
    } finally { setLoading(false); }
  }

  const competitors = analysis?.competitors ?? [];
  const direct = competitors.filter((item) => item.relationship !== "substitute");
  const positionCounts = analysis ? {
    low: direct.filter((item) => Number(item.offer_price) > analysis.metrics.referencePrice * 1.05).length,
    equal: direct.filter((item) => Math.abs(Number(item.offer_price) - analysis.metrics.referencePrice) <= analysis.metrics.referencePrice * 0.05).length,
    high: direct.filter((item) => Number(item.offer_price) < analysis.metrics.referencePrice * 0.95).length,
  } : { low: 0, equal: 0, high: 0 };

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span>MGP RETAIL INTELLIGENCE</span><h1>Competitive Pricing Intelligence</h1><p>Detecta automáticamente el set competitivo de un producto y evalúa su posición de precio con un motor híbrido de similitud.</p></div>
      <a href="/">Volver al dashboard</a>
    </header>

    <form className={styles.search} onSubmit={search}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, marca o formato…" />
      <button disabled={loading}>{loading ? "Analizando…" : "Buscar producto"}</button>
    </form>

    {error && <div className={styles.error}>{error}</div>}

    {results.length > 0 && <section className={styles.results}>
      <h2>Selecciona el producto de referencia</h2>
      <div>{results.map((product) => <button key={product.id} onClick={() => analyze(product.id)}>
        <span className={styles.thumb}>{product.image_url ? <Image src={product.image_url} alt="" width={54} height={54} /> : "SKU"}</span>
        <span><strong>{product.name}</strong><small>{product.supermarket} · {product.brand || "Sin marca"}</small></span>
        <b>{money.format(Number(product.offer_price))}</b>
      </button>)}</div>
    </section>}

    {analysis && <>
      <section className={styles.heroGrid}>
        <article className={styles.targetCard}>
          <span>PRODUCTO ANALIZADO</span>
          <div><span className={styles.largeThumb}>{analysis.target.image_url ? <Image src={analysis.target.image_url} alt="" width={88} height={88} /> : "SKU"}</span><div><h2>{analysis.target.name}</h2><p>{analysis.target.supermarket} · {analysis.target.brand || "Sin marca"}</p></div></div>
          <strong>{money.format(analysis.metrics.referencePrice)}</strong>
        </article>
        <article className={`${styles.positionCard} ${styles[analysis.metrics.position.code]}`}>
          <span>POSICIÓN DE PRECIO</span><strong>{analysis.metrics.position.diffPct >= 0 ? "+" : ""}{analysis.metrics.position.diffPct.toFixed(1)}%</strong><h2>{analysis.metrics.position.label}</h2><p>Frente al promedio del set competitivo</p>
        </article>
        <article className={styles.recommendationCard}>
          <span>RANGO COMPETITIVO RECOMENDADO</span><strong>{money.format(analysis.metrics.recommendedMin)} – {money.format(analysis.metrics.recommendedMax)}</strong><p>Promedio de mercado ±5%</p>
        </article>
      </section>

      <section className={styles.metrics}>
        <article><span>Promedio competitivo</span><strong>{money.format(analysis.metrics.marketAverage)}</strong></article>
        <article><span>Precio mínimo</span><strong>{money.format(analysis.metrics.marketMin)}</strong></article>
        <article><span>Precio máximo</span><strong>{money.format(analysis.metrics.marketMax)}</strong></article>
        <article><span>Ranking de precio</span><strong>{analysis.metrics.rank || "—"} / {analysis.metrics.totalRanked}</strong></article>
      </section>

      <section className={styles.analysisGrid}>
        <article className={styles.distribution}>
          <div className={styles.sectionHead}><span>MARKET POSITIONING</span><h2>Distribución competitiva</h2></div>
          <div className={styles.donuts}>
            <div><i style={{ "--value": `${Math.min(100, positionCounts.low * 18 + 18)}%` } as React.CSSProperties} /><strong>{positionCounts.low}</strong><span>Más caros</span></div>
            <div><i style={{ "--value": `${Math.min(100, positionCounts.equal * 18 + 18)}%` } as React.CSSProperties} /><strong>{positionCounts.equal}</strong><span>Equivalentes</span></div>
            <div><i style={{ "--value": `${Math.min(100, positionCounts.high * 18 + 18)}%` } as React.CSSProperties} /><strong>{positionCounts.high}</strong><span>Más baratos</span></div>
          </div>
        </article>
        <article className={styles.aiCard}>
          <div className={styles.sectionHead}><span>AI EXPLANATION</span><h2>Lectura inteligente</h2></div>
          <p>{analysis.explanation}</p>
          <div><span>Brecha vs. más barato</span><strong>{money.format(analysis.metrics.gapVsCheapest)} · {analysis.metrics.gapVsCheapestPct.toFixed(1)}%</strong></div>
        </article>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.sectionHead}><span>COMPETITIVE SET</span><h2>Productos detectados como competencia</h2></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Cadena</th><th>Tipo</th><th>Confianza</th><th>Precio</th><th>Brecha</th></tr></thead><tbody>
          {competitors.map((item) => <tr key={item.id}><td><div className={styles.productCell}><span className={styles.thumb}>{item.image_url ? <Image src={item.image_url} alt="" width={48} height={48} /> : "SKU"}</span><div><strong>{item.name}</strong><small>{item.reasons.join(" · ")}</small></div></div></td><td>{item.supermarket}</td><td><span className={styles.relationship}>{relationshipLabel[item.relationship]}</span></td><td>{item.similarity.toFixed(1)}%</td><td><strong>{money.format(Number(item.offer_price))}</strong></td><td className={item.price_gap > 0 ? styles.positive : styles.negative}>{item.price_gap > 0 ? "+" : ""}{money.format(item.price_gap)}</td></tr>)}
        </tbody></table></div>
      </section>
    </>}
  </main>;
}
