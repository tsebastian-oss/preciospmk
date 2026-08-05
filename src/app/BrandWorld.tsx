"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./brand-world.module.css";

export type BrandView =
  | "brand-overview"
  | "digital-shelf"
  | "brand-pricing"
  | "availability"
  | "benchmark"
  | "scorecards"
  | "launch-tracker";

type Product = {
  id: string;
  supermarket: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | string | null;
  offer_price: number | string | null;
  in_stock: boolean;
  observed_at: string;
  discount_pct: number | string | null;
};

type Scorecard = {
  retailer: string;
  listings: number;
  available: number;
  availabilityPct: number;
  promotions: number;
  promotionPct: number;
  averagePrice: number;
  priceIndex: number;
  imageCoveragePct: number;
  titleQualityPct: number;
  digitalShelfScore: number;
};

type BrandData = {
  selectedBrand: string | null;
  suggestions: Array<{ brand: string; products: number }>;
  summary: {
    totalProducts: number;
    inStockProducts: number;
    availabilityPct: number;
    promotions: number;
    promotionPct: number;
    retailerPresence: number;
    averagePrice: number;
    categoryAveragePrice: number;
    priceIndex: number;
    imageCoveragePct: number;
    titleQualityPct: number;
    digitalShelfScore: number;
    primaryCategory: string | null;
  };
  retailerScorecards: Scorecard[];
  categoryMix: Array<{ name: string; products: number }>;
  competitors: Array<{
    brand: string;
    products: number;
    availabilityPct: number;
    promotionPct: number;
    averagePrice: number;
    priceIndexVsBrand: number;
  }>;
  coverageGaps: Array<{ productKey: string; presentIn: string[]; missingIn: string[] }>;
  recentProducts: Product[];
  opportunities: string[];
  risks: string[];
  generatedAt: string;
  error?: string;
};

const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("es-CL");

function tone(index: number) {
  if (!Number.isFinite(index) || index === 0) return "neutral";
  if (index <= 97) return "good";
  if (index <= 103) return "neutral";
  if (index <= 108) return "warning";
  return "risk";
}

function observedAt(input: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(input));
}

function productPrice(product: Product) {
  const offer = Number(product.offer_price ?? 0);
  const regular = Number(product.regular_price ?? 0);
  return offer > 0 ? offer : regular;
}

function Ring({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return <div className={styles.ringBlock}>
    <div className={styles.ring} style={{ background: `conic-gradient(#d948ff ${safe * 3.6}deg, #27263a 0deg)` }}>
      <div><strong>{safe.toFixed(0)}</strong><span>/100</span></div>
    </div>
    <span>{label}</span>
  </div>;
}

export default function BrandWorld({ view }: { view: BrandView }) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<BrandData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("mgp-selected-brand");
    if (saved) {
      setQuery(saved);
      void loadBrand(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBrand(brand: string) {
    const cleaned = brand.trim();
    if (cleaned.length < 2) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/brand-intelligence?q=${encodeURIComponent(cleaned)}`, { cache: "no-store" });
      const payload = await response.json() as BrandData;
      if (!response.ok) throw new Error(payload.error || "No fue posible construir la inteligencia de marca");
      setData(payload);
      if (payload.selectedBrand) {
        setQuery(payload.selectedBrand);
        window.localStorage.setItem("mgp-selected-brand", payload.selectedBrand);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error cargando la marca");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void loadBrand(query);
  }

  const maxCategory = Math.max(...(data?.categoryMix.map((item) => item.products) ?? [1]));
  const weakestScorecard = useMemo(() => data?.retailerScorecards
    .filter((item) => item.listings > 0)
    .sort((left, right) => left.digitalShelfScore - right.digitalShelfScore)[0], [data]);

  if (!data) {
    return <section className={styles.workspace}>
      <div className={styles.brandHero}>
        <div>
          <span>BRAND INTELLIGENCE WORKSPACE</span>
          <h2>Convierte la ejecución digital de tu marca en evidencia comercial.</h2>
          <p>Selecciona una marca para analizar presencia, disponibilidad, precio, promociones, calidad de ficha y presión competitiva por retailer.</p>
          <div className={styles.capabilities}>
            <b>Digital Shelf</b><b>Price Compliance</b><b>Availability</b><b>Retailer Scorecards</b>
          </div>
        </div>
        <form onSubmit={submit} className={styles.brandSearch}>
          <label>Marca a analizar</label>
          <div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej. Coca-Cola, Ariel, Samsung" /><button disabled={loading || query.trim().length < 2}>{loading ? "Analizando…" : "Crear scorecard"}</button></div>
          <small>El sistema buscará la marca y sus productos publicados en todos los retailers monitoreados.</small>
        </form>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.brandMethod}>
        <article><span>01</span><strong>Encuentra la marca</strong><p>Consolida todos sus SKU y retailers.</p></article>
        <article><span>02</span><strong>Mide ejecución</strong><p>Stock, promociones, contenido y precio.</p></article>
        <article><span>03</span><strong>Prioriza acciones</strong><p>Detecta brechas y oportunidades comerciales.</p></article>
      </div>
    </section>;
  }

  const summary = data.summary;

  return <section className={styles.workspace}>
    <div className={styles.toolbar}>
      <div><span>MARCA ACTIVA</span><strong>{data.selectedBrand}</strong><small>{summary.primaryCategory || "Categoría no clasificada"}</small></div>
      <form onSubmit={submit}><input value={query} onChange={(event) => setQuery(event.target.value)} /><button disabled={loading}>{loading ? "Actualizando…" : "Cambiar marca"}</button></form>
    </div>
    {error && <div className={styles.error}>{error}</div>}

    {view === "brand-overview" && <>
      <div className={styles.executiveGrid}>
        <article className={styles.heroCard}>
          <span>BRAND HEALTH SNAPSHOT</span>
          <h2>{data.selectedBrand}</h2>
          <p>Lectura consolidada de ejecución pública en {summary.retailerPresence} retailers.</p>
          <div className={styles.heroMetrics}>
            <div><strong>{number.format(summary.totalProducts)}</strong><span>SKU visibles</span></div>
            <div><strong>{summary.availabilityPct.toFixed(0)}%</strong><span>Disponibilidad</span></div>
            <div><strong>{summary.promotionPct.toFixed(0)}%</strong><span>En promoción</span></div>
          </div>
        </article>
        <article className={styles.scoreHero}>
          <Ring value={summary.digitalShelfScore} label="Digital shelf score" />
          <div><span>PRIORIDAD EJECUTIVA</span><strong>{weakestScorecard ? `Reforzar ${weakestScorecard.retailer}` : "Mantener ejecución"}</strong><p>{data.opportunities[0]}</p></div>
        </article>
      </div>

      <div className={styles.metricGrid}>
        <article><span>Índice de precio</span><strong className={styles[tone(summary.priceIndex)]}>{summary.priceIndex ? summary.priceIndex.toFixed(1) : "—"}</strong><small>Mercado categoría = 100</small></article>
        <article><span>Cobertura de imágenes</span><strong>{summary.imageCoveragePct.toFixed(0)}%</strong><small>Ficha visual completa</small></article>
        <article><span>Calidad de título</span><strong>{summary.titleQualityPct.toFixed(0)}%</strong><small>Títulos descriptivos</small></article>
        <article><span>Brechas de distribución</span><strong>{number.format(data.coverageGaps.length)}</strong><small>Referencias ausentes</small></article>
      </div>

      <div className={styles.dualGrid}>
        <article className={styles.panel}><div className={styles.panelHead}><div><span>RETAILER SCORECARDS</span><h3>Ejecución por cadena</h3></div></div><div className={styles.scorecardList}>{data.retailerScorecards.map((item) => <div key={item.retailer}><div><strong>{item.retailer}</strong><span>{item.listings} SKU</span></div><div className={styles.scoreBar}><i style={{ width: `${item.digitalShelfScore}%` }} /></div><b>{item.digitalShelfScore}/100</b></div>)}</div></article>
        <article className={styles.panel}><div className={styles.panelHead}><div><span>AI PRIORITIES</span><h3>Oportunidades y riesgos</h3></div></div><div className={styles.insightColumns}><div><strong>Acciones</strong>{data.opportunities.map((item) => <p key={item}>↗ {item}</p>)}</div><div><strong>Riesgos</strong>{data.risks.map((item) => <p key={item}>! {item}</p>)}</div></div></article>
      </div>
    </>}

    {view === "digital-shelf" && <>
      <div className={styles.metricGrid}>
        <article><span>Digital shelf score</span><strong>{summary.digitalShelfScore}</strong><small>Índice compuesto /100</small></article>
        <article><span>Imágenes</span><strong>{summary.imageCoveragePct.toFixed(0)}%</strong><small>Productos con imagen</small></article>
        <article><span>Títulos útiles</span><strong>{summary.titleQualityPct.toFixed(0)}%</strong><small>Descripción suficiente</small></article>
        <article><span>Distribución</span><strong>{summary.retailerPresence}/3</strong><small>Retailers con presencia</small></article>
      </div>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>DIGITAL SHELF</span><h3>Calidad de ejecución por retailer</h3></div></div><div className={styles.retailerCards}>{data.retailerScorecards.map((item) => <article key={item.retailer}><div><strong>{item.retailer}</strong><b>{item.digitalShelfScore}/100</b></div><p><span>Listings</span><strong>{item.listings}</strong></p><p><span>Imagen</span><strong>{item.imageCoveragePct.toFixed(0)}%</strong></p><p><span>Título</span><strong>{item.titleQualityPct.toFixed(0)}%</strong></p><p><span>Disponibilidad</span><strong>{item.availabilityPct.toFixed(0)}%</strong></p></article>)}</div></article>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>CATEGORY PRESENCE</span><h3>Mix de categorías publicado</h3></div></div><div className={styles.categoryBars}>{data.categoryMix.map((item) => <div key={item.name}><div><strong>{item.name}</strong><span>{item.products} SKU</span></div><i><b style={{ width: `${item.products / maxCategory * 100}%` }} /></i></div>)}</div></article>
    </>}

    {view === "brand-pricing" && <>
      <div className={styles.pricingHero}>
        <article><span>ÍNDICE DE PRECIO DE MARCA</span><strong className={styles[tone(summary.priceIndex)]}>{summary.priceIndex ? summary.priceIndex.toFixed(1) : "—"}</strong><p>Promedio de la categoría = 100. Precio medio de marca: {money.format(summary.averagePrice)}.</p></article>
        <article><span>LECTURA</span><h3>{summary.priceIndex > 105 ? "Prima relevante frente a categoría" : summary.priceIndex < 97 ? "Posición competitiva de precio" : "Precio alineado al mercado"}</h3><p>Benchmark de categoría: {money.format(summary.categoryAveragePrice)}.</p></article>
      </div>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>PRICE BY RETAILER</span><h3>Índice y presión promocional</h3></div></div><div className={styles.tableWrap}><table><thead><tr><th>Retailer</th><th>Precio medio</th><th>Índice marca</th><th>Promoción</th><th>Disponibilidad</th></tr></thead><tbody>{data.retailerScorecards.map((item) => <tr key={item.retailer}><td><strong>{item.retailer}</strong></td><td>{item.averagePrice ? money.format(item.averagePrice) : "—"}</td><td><b className={styles[tone(item.priceIndex)]}>{item.priceIndex ? item.priceIndex.toFixed(1) : "—"}</b></td><td>{item.promotionPct.toFixed(0)}%</td><td>{item.availabilityPct.toFixed(0)}%</td></tr>)}</tbody></table></div></article>
    </>}

    {view === "availability" && <>
      <div className={styles.metricGrid}><article><span>Disponibilidad total</span><strong>{summary.availabilityPct.toFixed(0)}%</strong><small>{summary.inStockProducts} SKU con stock</small></article><article><span>Referencias con brecha</span><strong>{data.coverageGaps.length}</strong><small>Ausentes en al menos una cadena</small></article><article><span>Retailers activos</span><strong>{summary.retailerPresence}/3</strong><small>Presencia digital</small></article><article><span>SKU monitoreados</span><strong>{summary.totalProducts}</strong><small>Portafolio encontrado</small></article></div>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>AVAILABILITY</span><h3>Disponibilidad por retailer</h3></div></div><div className={styles.availabilityGrid}>{data.retailerScorecards.map((item) => <article key={item.retailer}><span>{item.retailer}</span><strong>{item.availabilityPct.toFixed(0)}%</strong><div><i style={{ width: `${item.availabilityPct}%` }} /></div><small>{item.available} de {item.listings} SKU disponibles</small></article>)}</div></article>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>DISTRIBUTION GAPS</span><h3>Referencias que faltan por cadena</h3></div></div><div className={styles.gapList}>{data.coverageGaps.length ? data.coverageGaps.map((gap) => <div key={gap.productKey}><strong>{gap.productKey}</strong><span>Presente: {gap.presentIn.join(", ")}</span><b>Falta: {gap.missingIn.join(", ")}</b></div>) : <p className={styles.emptyCopy}>No se detectaron brechas con el matching actual.</p>}</div></article>
    </>}

    {view === "benchmark" && <>
      <div className={styles.benchmarkIntro}><div><span>COMPETITIVE BRAND INDEX</span><h2>{data.selectedBrand} frente a marcas de {summary.primaryCategory || "su categoría"}</h2></div><p>El benchmark compara amplitud de portafolio, disponibilidad, actividad promocional y precio promedio público.</p></div>
      <div className={styles.competitorGrid}>{data.competitors.map((item, index) => <article key={item.brand}><span>#{index + 1}</span><h3>{item.brand}</h3><strong>{item.products} SKU</strong><div><p><span>Disponibilidad</span><b>{item.availabilityPct.toFixed(0)}%</b></p><p><span>Promoción</span><b>{item.promotionPct.toFixed(0)}%</b></p><p><span>Precio medio</span><b>{money.format(item.averagePrice)}</b></p><p><span>Índice vs marca</span><b>{item.priceIndexVsBrand.toFixed(0)}</b></p></div></article>)}</div>
    </>}

    {view === "scorecards" && <article className={styles.panel}><div className={styles.panelHead}><div><span>RETAILER SCORECARDS</span><h3>Evaluación comercial consolidada</h3></div></div><div className={styles.tableWrap}><table><thead><tr><th>Retailer</th><th>Digital shelf</th><th>Listings</th><th>Disponibilidad</th><th>Promoción</th><th>Precio index</th><th>Imagen</th></tr></thead><tbody>{data.retailerScorecards.map((item) => <tr key={item.retailer}><td><strong>{item.retailer}</strong></td><td><b>{item.digitalShelfScore}/100</b></td><td>{item.listings}</td><td>{item.availabilityPct.toFixed(0)}%</td><td>{item.promotionPct.toFixed(0)}%</td><td className={styles[tone(item.priceIndex)]}>{item.priceIndex ? item.priceIndex.toFixed(1) : "—"}</td><td>{item.imageCoveragePct.toFixed(0)}%</td></tr>)}</tbody></table></div></article>}

    {view === "launch-tracker" && <>
      <div className={styles.launchHeader}><div><span>LAUNCH & LISTING TRACKER</span><h2>Últimos SKU observados</h2></div><p>La fecha corresponde a la observación pública más reciente. El tracking de aparición histórica se enriquecerá con cada corrida diaria.</p></div>
      <div className={styles.launchGrid}>{data.recentProducts.map((product) => <a key={product.id} href={product.url} target="_blank" rel="noreferrer"><span className={styles.launchImage}>{product.image_url ? <Image src={product.image_url} alt="" width={62} height={62} /> : "SKU"}</span><div><small>{product.supermarket} · {observedAt(product.observed_at)}</small><strong>{product.name}</strong><p>{product.category || "Sin categoría"}</p></div><b>{money.format(productPrice(product))}</b></a>)}</div>
    </>}
  </section>;
}
