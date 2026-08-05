"use client";

import Image from "next/image";
import { useMemo, useState, type FormEvent } from "react";
import styles from "./competitive-workspace.module.css";

type Product = {
  id: string;
  supermarket: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url?: string | null;
  regular_price: number | string | null;
  offer_price: number | string;
};

type Relationship = "equivalent" | "direct_competitor" | "substitute";
type Competitor = Product & {
  relationship: Relationship;
  similarity: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  warnings: string[];
  price_gap: number;
};

type Analysis = {
  target: Product;
  competitors: Competitor[];
  metrics: {
    referencePrice: number;
    marketMedian: number;
    marketMin: number;
    marketMax: number;
    rank: number;
    totalRanked: number;
    recommendedMin: number;
    recommendedMax: number;
    gapVsCheapest: number;
    position: { code: "low" | "equal" | "high" | "overpriced"; label: string; diffPct: number };
    equivalentCount: number;
    directCount: number;
    substituteCount: number;
  };
  ai: {
    enabled: boolean;
    model: string | null;
    explanation: string;
    actions: string[];
    risks: string[];
    error?: string;
  };
  generatedAt?: string;
};

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const relationshipLabels: Record<Relationship, string> = {
  equivalent: "Equivalente",
  direct_competitor: "Competidor directo",
  substitute: "Sustituto",
};

const confidenceLabels: Record<Competitor["confidence"], string> = {
  high: "Alta",
  medium: "Media",
  low: "Exploratoria",
};

function numeric(input: number | string | null | undefined) {
  const parsed = Number(input ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productPrice(product: Product) {
  const offer = numeric(product.offer_price);
  return offer > 0 ? offer : numeric(product.regular_price);
}

function percentagePosition(reference: number, minimum: number, maximum: number) {
  if (maximum <= minimum) return 50;
  return Math.max(3, Math.min(97, ((reference - minimum) / (maximum - minimum)) * 100));
}

function formatGeneratedAt(input?: string) {
  if (!input) return "Análisis actual";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input));
}

export default function CompetitiveWorkspace() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Relationship | "all">("all");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = query.trim();
    if (cleaned.length < 2) return;

    setLoading(true);
    setError("");
    setAnalysis(null);
    setFilter("all");

    try {
      const response = await fetch(`/api/competitive-analysis?q=${encodeURIComponent(cleaned)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible buscar productos");
      setResults(data.searchResults || []);
      if (!(data.searchResults || []).length) setError("No encontramos productos con esa búsqueda.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de búsqueda");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function analyze(id: string) {
    setLoading(true);
    setError("");
    setFilter("all");

    try {
      const response = await fetch(`/api/competitive-analysis?productId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible analizar el producto");
      setAnalysis(data);
      setResults([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de análisis");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setAnalysis(null);
    setResults([]);
    setError("");
    setFilter("all");
    setQuery("");
  }

  const visibleCompetitors = useMemo(() => {
    if (!analysis) return [];
    return filter === "all"
      ? analysis.competitors
      : analysis.competitors.filter((item) => item.relationship === filter);
  }, [analysis, filter]);

  const filterCounts = useMemo(() => {
    if (!analysis) return { all: 0, equivalent: 0, direct_competitor: 0, substitute: 0 };
    return {
      all: analysis.competitors.length,
      equivalent: analysis.competitors.filter((item) => item.relationship === "equivalent").length,
      direct_competitor: analysis.competitors.filter((item) => item.relationship === "direct_competitor").length,
      substitute: analysis.competitors.filter((item) => item.relationship === "substitute").length,
    };
  }, [analysis]);

  const marketMarker = analysis
    ? percentagePosition(
        analysis.metrics.referencePrice,
        analysis.metrics.marketMin,
        analysis.metrics.marketMax,
      )
    : 50;

  return <section className={styles.workspace}>
    <div className={styles.commandDeck}>
      <div className={styles.commandCopy}>
        <span className={styles.kicker}>Motor competitivo con IA</span>
        <h2>Analiza la posición real de cualquier SKU frente al mercado.</h2>
        <p>
          El sistema combina marca, categoría, formato, variante, similitud semántica y precio para
          construir un set competitivo auditable y generar una lectura ejecutiva accionable.
        </p>
        <div className={styles.capabilities}>
          <span>Matching estructurado</span>
          <span>Posición de precio</span>
          <span>Briefing ejecutivo IA</span>
          <span>Riesgos y acciones</span>
        </div>
      </div>

      <form className={styles.commandForm} onSubmit={search}>
        <label className={styles.formLabel} htmlFor="competitive-search">
          <span>Producto de referencia</span>
          <b>LIVE DATABASE</b>
        </label>
        <div className={styles.searchRow}>
          <input
            id="competitive-search"
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ej. Coca-Cola Zero 1,5 L o detergente Ariel"
            autoComplete="off"
          />
          <button
            className={styles.searchButton}
            disabled={loading || query.trim().length < 2}
          >
            {loading ? "Procesando…" : "Buscar SKU"}
          </button>
        </div>
        <div className={styles.formHint}>
          <span>Busca por nombre, marca o variante.</span>
          <span>La IA se ejecuta después de seleccionar el producto.</span>
        </div>
      </form>
    </div>

    {error && <div className={styles.error}>{error}</div>}

    {loading && <div className={styles.loadingPanel}>
      <div><span className={styles.spinner} /><strong>Construyendo análisis competitivo…</strong></div>
    </div>}

    {!loading && !analysis && results.length === 0 && !error && <div className={styles.emptyState}>
      <article className={styles.emptyMain}>
        <div>
          <span className={styles.sectionKicker}>Cómo funciona</span>
          <h3>De un SKU aislado a una decisión de pricing defendible.</h3>
          <p>
            Selecciona un producto y el motor separará equivalentes, competidores directos y sustitutos,
            evitando mezclar formatos o categorías que no correspondan.
          </p>
        </div>
        <div className={styles.methodLine}>
          <div><strong>01 · Identidad</strong><span>Marca, categoría y atributos.</span></div>
          <div><strong>02 · Comparabilidad</strong><span>Formato, variante y similitud.</span></div>
          <div><strong>03 · Recomendación</strong><span>Brecha, rango y acciones.</span></div>
        </div>
      </article>
      <div className={styles.emptyFeatures}>
        <article className={styles.emptyFeature}><b>EQ</b><strong>Equivalentes</strong><span>Mismo producto o formato directamente comparable.</span></article>
        <article className={styles.emptyFeature}><b>DC</b><strong>Competidores directos</strong><span>Alternativas cercanas dentro de la misma ocasión.</span></article>
        <article className={styles.emptyFeature}><b>AI</b><strong>Lectura ejecutiva</strong><span>Explicación, acciones recomendadas y riesgos comerciales.</span></article>
      </div>
    </div>}

    {!loading && results.length > 0 && <section className={styles.resultsPanel}>
      <div className={styles.sectionHeader}>
        <div><span className={styles.sectionKicker}>Resultados de búsqueda</span><h3>Selecciona el SKU objetivo</h3></div>
        <p>{results.length} alternativas encontradas</p>
      </div>
      <div className={styles.resultGrid}>
        {results.map((product) => <button
          type="button"
          key={product.id}
          className={styles.resultButton}
          onClick={() => analyze(product.id)}
        >
          <span className={styles.productThumb}>
            {product.image_url
              ? <Image src={product.image_url} alt="" width={54} height={54} />
              : "SKU"}
          </span>
          <span className={styles.resultCopy}>
            <strong>{product.name}</strong>
            <span>{product.supermarket} · {product.brand || "Sin marca"} · {product.category || "Sin categoría"}</span>
          </span>
          <span className={styles.resultPrice}>
            <strong>{money.format(productPrice(product))}</strong>
            <span>Analizar →</span>
          </span>
        </button>)}
      </div>
    </section>}

    {!loading && analysis && <div className={styles.analysis}>
      <div className={styles.analysisTop}>
        <article className={styles.targetCard}>
          <div className={styles.targetTop}>
            <div className={styles.targetIdentity}>
              <span className={styles.targetImage}>
                {analysis.target.image_url
                  ? <Image src={analysis.target.image_url} alt="" width={76} height={76} />
                  : "SKU"}
              </span>
              <div>
                <span className={styles.sectionKicker}>Producto analizado</span>
                <h3>{analysis.target.name}</h3>
                <p>{analysis.target.supermarket} · {analysis.target.brand || "Sin marca"} · {analysis.target.category || "Sin categoría"}</p>
              </div>
            </div>
            <button type="button" className={styles.resetButton} onClick={reset}>Nuevo análisis</button>
          </div>
          <div className={styles.targetPrice}>
            <div><span>Precio observado</span><strong>{money.format(analysis.metrics.referencePrice)}</strong></div>
            <small>{formatGeneratedAt(analysis.generatedAt)}<br />Set competitivo: {analysis.competitors.length} productos</small>
          </div>
        </article>

        <article className={`${styles.positionOverview} ${styles[analysis.metrics.position.code]}`}>
          <div>
            <div className={styles.positionLabel}><span>Posición competitiva</span><b>vs. mediana</b></div>
            <strong>{analysis.metrics.position.diffPct >= 0 ? "+" : ""}{analysis.metrics.position.diffPct.toFixed(1)}%</strong>
            <h3>{analysis.metrics.position.label}</h3>
            <p>Rango recomendado: {money.format(analysis.metrics.recommendedMin)} – {money.format(analysis.metrics.recommendedMax)}</p>
          </div>
          <div className={styles.marketRange}>
            <div className={styles.rangeTrack}><span className={styles.rangeMarker} style={{ left: `${marketMarker}%` }} /></div>
            <div className={styles.rangeLabels}><span>{money.format(analysis.metrics.marketMin)}</span><span>Mediana {money.format(analysis.metrics.marketMedian)}</span><span>{money.format(analysis.metrics.marketMax)}</span></div>
          </div>
        </article>
      </div>

      <div className={styles.metricsGrid}>
        <article className={styles.metricCard}><span>Mediana de mercado</span><strong>{money.format(analysis.metrics.marketMedian)}</strong><small>Referencia principal</small></article>
        <article className={styles.metricCard}><span>Precio mínimo</span><strong>{money.format(analysis.metrics.marketMin)}</strong><small>Mejor precio detectado</small></article>
        <article className={styles.metricCard}><span>Ranking de precio</span><strong>{analysis.metrics.rank || "—"} / {analysis.metrics.totalRanked}</strong><small>1 = precio más bajo</small></article>
        <article className={styles.metricCard}><span>Set estricto</span><strong>{analysis.metrics.equivalentCount + analysis.metrics.directCount}</strong><small>{analysis.metrics.substituteCount} sustitutos adicionales</small></article>
      </div>

      <article className={styles.aiBrief}>
        <div className={styles.aiHeader}>
          <div className={styles.aiTitle}>
            <span className={styles.aiIcon}>AI</span>
            <div><strong>Executive Pricing Brief</strong><span>{analysis.ai.enabled ? `Generado por ${analysis.ai.model || "OpenAI"}` : "Análisis estructurado de respaldo"}</span></div>
          </div>
          <span className={`${styles.aiStatus} ${!analysis.ai.enabled ? styles.fallback : ""}`}>
            {analysis.ai.enabled ? "IA ACTIVA" : "MODO ESTRUCTURADO"}
          </span>
        </div>
        <p className={styles.aiNarrative}>{analysis.ai.explanation}</p>
        {(analysis.ai.actions.length > 0 || analysis.ai.risks.length > 0) && <div className={styles.briefColumns}>
          {analysis.ai.actions.length > 0 && <div className={styles.briefColumn}>
            <span>Acciones recomendadas</span>
            <ul>{analysis.ai.actions.map((action) => <li key={action}>{action}</li>)}</ul>
          </div>}
          {analysis.ai.risks.length > 0 && <div className={`${styles.briefColumn} ${styles.risks}`}>
            <span>Riesgos detectados</span>
            <ul>{analysis.ai.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
          </div>}
        </div>}
        {!analysis.ai.enabled && analysis.ai.error && <small className={styles.aiError}>{analysis.ai.error}</small>}
      </article>

      <section className={styles.competitorPanel}>
        <div className={styles.sectionHeader}>
          <div><span className={styles.sectionKicker}>Competitive set</span><h3>Productos comparables detectados</h3></div>
          <div className={styles.filterBar}>
            <button type="button" className={`${styles.filterButton} ${filter === "all" ? styles.active : ""}`} onClick={() => setFilter("all")}>Todos · {filterCounts.all}</button>
            {(["equivalent", "direct_competitor", "substitute"] as Relationship[]).map((type) => <button
              type="button"
              key={type}
              className={`${styles.filterButton} ${filter === type ? styles.active : ""}`}
              onClick={() => setFilter(type)}
            >{relationshipLabels[type]} · {filterCounts[type]}</button>)}
          </div>
        </div>

        {visibleCompetitors.length > 0 ? <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Producto</th><th>Cadena</th><th>Relación</th><th>Confianza</th><th>Precio</th><th>Brecha objetivo</th><th /></tr></thead>
            <tbody>{visibleCompetitors.map((item) => <tr key={item.id}>
              <td className={styles.competitorProduct}>
                <strong>{item.name}</strong>
                <small>{item.reasons.join(" · ")}</small>
                {item.warnings.length > 0 && <em>{item.warnings.join(" · ")}</em>}
              </td>
              <td><span className={styles.storeName}>{item.supermarket}</span></td>
              <td><span className={`${styles.relationshipTag} ${styles[item.relationship]}`}>{relationshipLabels[item.relationship]}</span></td>
              <td className={styles.confidenceCell}>
                <strong>{item.similarity.toFixed(1)}% · {confidenceLabels[item.confidence]}</strong>
                <div className={styles.confidenceTrack}><span style={{ width: `${Math.max(4, Math.min(100, item.similarity))}%` }} /></div>
              </td>
              <td className={styles.priceCell}><strong>{money.format(productPrice(item))}</strong><small>{item.brand || "Sin marca"}</small></td>
              <td className={item.price_gap > 0 ? styles.expensive : styles.cheaper}>
                {item.price_gap > 0 ? "Objetivo +" : "Objetivo "}{money.format(item.price_gap)}
              </td>
              <td><a className={styles.externalLink} href={item.url} target="_blank" rel="noreferrer">Ver producto ↗</a></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className={styles.noCompetitors}>No hay productos para el filtro seleccionado.</div>}
      </section>
    </div>}
  </section>;
}
