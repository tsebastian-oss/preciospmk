"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./PriceOptimizerWorkspace.module.css";

type Numeric = number | string | null;
type Objective = "volume" | "balanced" | "margin";

type StoreListing = {
  supermarket: string;
  price: Numeric;
  in_stock?: boolean;
  url?: string;
};

type OptimizerProduct = {
  match_key: string;
  canonical_name: string;
  canonical_brand: string | null;
  category: string | null;
  smart_category: string | null;
  best_price: Numeric;
  average_price: Numeric;
  highest_price: Numeric;
  price_gap: Numeric;
  savings_pct: Numeric;
  match_method: string;
  match_confidence: Numeric;
  last_updated: string;
  image_url: string | null;
  store_listings: StoreListing[];
};

type CalculatedScenario = {
  objective: Objective;
  recommendedPrice: number;
  projectedUnits: number;
  projectedRevenue: number;
  projectedGrossProfit: number;
  projectedMarginPct: number;
  priceChangePct: number;
  unitsChangePct: number;
  revenueChangePct: number;
  grossProfitChangePct: number;
};

type Recommendation = {
  product: OptimizerProduct;
  selected: CalculatedScenario;
  scenarios: CalculatedScenario[];
  confidence: number;
  confidenceLabel: string;
  modelType: string;
  rationale: string[];
  forecast: Array<{ week: number; units: number; revenue: number }>;
  baseline: { revenue: number; grossProfit: number; marginPct: number };
  market: { minimum: number; average: number; maximum: number };
};

type HistoryItem = {
  id: string;
  product_name: string;
  objective: Objective;
  current_price: Numeric;
  recommended_price: Numeric;
  projected_revenue: Numeric;
  projected_gross_profit: Numeric;
  confidence: Numeric;
  created_at: string;
};

const moneyFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

function value(input: Numeric | undefined, fallback = 0) {
  const parsed = Number(input ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(input: Numeric | undefined) {
  return moneyFormatter.format(value(input));
}

function number(input: Numeric | undefined) {
  return numberFormatter.format(value(input));
}

function pct(input: Numeric | undefined) {
  const parsed = value(input);
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(1)}%`;
}

function objectiveLabel(objective: Objective) {
  if (objective === "volume") return "Maximizar volumen";
  if (objective === "margin") return "Maximizar margen";
  return "Equilibrar ventas y margen";
}

export default function PriceOptimizerWorkspace() {
  const [products, setProducts] = useState<OptimizerProduct[]>([]);
  const [selected, setSelected] = useState<OptimizerProduct | null>(null);
  const [query, setQuery] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [objective, setObjective] = useState<Objective>("balanced");
  const [currentPrice, setCurrentPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [baselineUnits, setBaselineUnits] = useState("1000");
  const [stockUnits, setStockUnits] = useState("");
  const [minMarginPct, setMinMarginPct] = useState("20");
  const [elasticity, setElasticity] = useState("-1.4");

  async function loadProducts(search = "") {
    setLoadingProducts(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`/api/price-optimizer?${params}`, { cache: "no-store" });
      const payload = await response.json() as { products?: OptimizerProduct[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar productos comparables.");
      setProducts(payload.products ?? []);
      if (!selected && payload.products?.length) selectProduct(payload.products[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error cargando productos.");
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadHistory() {
    try {
      const response = await fetch("/api/price-optimizer?history=true", { cache: "no-store" });
      const payload = await response.json() as { history?: HistoryItem[] };
      if (response.ok) setHistory(payload.history ?? []);
    } catch {
      // History is supplementary; the optimizer remains available.
    }
  }

  useEffect(() => {
    void loadProducts();
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectProduct(product: OptimizerProduct) {
    const marketAverage = Math.max(1, Math.round(value(product.average_price)));
    setSelected(product);
    setCurrentPrice(String(marketAverage));
    setUnitCost(String(Math.round(marketAverage * 0.68)));
    setRecommendation(null);
    setError("");
  }

  async function searchProducts(event: FormEvent) {
    event.preventDefault();
    await loadProducts(query);
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setCalculating(true);
    setError("");
    try {
      const response = await fetch("/api/price-optimizer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchKey: selected.match_key,
          objective,
          currentPrice: Number(currentPrice),
          unitCost: Number(unitCost),
          baselineUnits: Number(baselineUnits),
          stockUnits: stockUnits ? Number(stockUnits) : null,
          minMarginPct: Number(minMarginPct),
          elasticity: Number(elasticity),
        }),
      });
      const payload = await response.json() as { recommendation?: Recommendation; error?: string };
      if (!response.ok || !payload.recommendation) throw new Error(payload.error || "No fue posible calcular la recomendación.");
      setRecommendation(payload.recommendation);
      await loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error calculando recomendación.");
    } finally {
      setCalculating(false);
    }
  }

  const maximumForecast = useMemo(() => Math.max(...(recommendation?.forecast.map((item) => item.revenue) ?? [1])), [recommendation]);
  const selectedScenario = recommendation?.selected;

  return <section className={styles.workspace}>
    <div className={styles.hero}>
      <div>
        <span>AI PRICE OPTIMIZER</span>
        <h2>Recomienda precios, protege margen y proyecta ventas.</h2>
        <p>Combina precio competitivo, costo, volumen base, inventario y elasticidad para simular decisiones por SKU.</p>
      </div>
      <div className={styles.heroBadge}><b>3</b><span>escenarios por producto</span><small>Volumen · Equilibrio · Margen</small></div>
    </div>

    <div className={styles.methodStrip}>
      <div><b>Mercado</b><span>Lider, Jumbo y Santa Isabel</span></div>
      <div><b>Restricciones</b><span>Costo, margen mínimo y stock</span></div>
      <div><b>Proyección</b><span>Elasticidad y demanda estimada</span></div>
      <div><b>Transparencia</b><span>Supuestos y confianza visibles</span></div>
    </div>

    {error && <div className={styles.error}>{error}</div>}

    <div className={styles.mainGrid}>
      <aside className={styles.catalogPanel}>
        <div className={styles.panelTitle}><div><span>PASO 1</span><h3>Selecciona el SKU</h3></div><b>{products.length}</b></div>
        <form className={styles.search} onSubmit={searchProducts}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, marca o categoría" />
          <button>Buscar</button>
        </form>
        <div className={styles.productList}>
          {loadingProducts ? <div className={styles.loading}>Buscando matches de tres cadenas…</div> : products.map((product) =>
            <button key={product.match_key} className={selected?.match_key === product.match_key ? styles.productActive : ""} onClick={() => selectProduct(product)}>
              <div className={styles.productImage}>{product.image_url ? <Image src={product.image_url} alt="" width={48} height={48} /> : "SKU"}</div>
              <div><strong>{product.canonical_name}</strong><span>{product.canonical_brand || "Sin marca"} · {product.smart_category || product.category || "Sin categoría"}</span><small>{product.match_method === "exact" ? "Match exacto" : `Match IA ${Math.round(value(product.match_confidence) * 100)}%`} · promedio {money(product.average_price)}</small></div>
            </button>)}
        </div>
      </aside>

      <div className={styles.modelPanel}>
        <div className={styles.panelTitle}><div><span>PASO 2</span><h3>Configura la decisión</h3></div><b>IA</b></div>
        {selected ? <>
          <div className={styles.selectedProduct}>
            <div><span>Producto seleccionado</span><strong>{selected.canonical_name}</strong><small>{selected.canonical_brand || "Sin marca"}</small></div>
            <div className={styles.marketPrices}>{selected.store_listings.map((listing) => <div key={listing.supermarket}><span>{listing.supermarket}</span><b>{money(listing.price)}</b></div>)}</div>
          </div>

          <form className={styles.form} onSubmit={calculate}>
            <label className={styles.wide}><span>Objetivo comercial</span><select value={objective} onChange={(event) => setObjective(event.target.value as Objective)}><option value="volume">Maximizar volumen</option><option value="balanced">Equilibrar ventas y margen</option><option value="margin">Maximizar margen bruto</option></select></label>
            <label><span>Precio actual</span><div><i>$</i><input type="number" min="1" value={currentPrice} onChange={(event) => setCurrentPrice(event.target.value)} /></div></label>
            <label><span>Costo unitario</span><div><i>$</i><input type="number" min="0" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></div></label>
            <label><span>Unidades mensuales</span><input type="number" min="1" value={baselineUnits} onChange={(event) => setBaselineUnits(event.target.value)} /></label>
            <label><span>Stock disponible</span><input type="number" min="0" value={stockUnits} onChange={(event) => setStockUnits(event.target.value)} placeholder="Sin límite" /></label>
            <label><span>Margen mínimo</span><div><input type="number" min="0" max="85" value={minMarginPct} onChange={(event) => setMinMarginPct(event.target.value)} /><i>%</i></div></label>
            <label><span>Elasticidad estimada</span><input type="number" min="-4" max="-0.1" step="0.1" value={elasticity} onChange={(event) => setElasticity(event.target.value)} /></label>
            <div className={styles.assumption}><b>Modelo inicial</b><span>La elasticidad es un supuesto editable. Con históricos de ventas se reemplazará por una estimación observada.</span></div>
            <button className={styles.calculate} disabled={calculating}>{calculating ? "Optimizando…" : "Calcular precio recomendado"}</button>
          </form>
        </> : <div className={styles.empty}>Selecciona un producto comparable para comenzar.</div>}
      </div>
    </div>

    {recommendation && selectedScenario && <>
      <div className={styles.resultHeader}><div><span>RECOMENDACIÓN GENERADA</span><h3>{objectiveLabel(selectedScenario.objective)}</h3></div><div><b>{Math.round(recommendation.confidence * 100)}%</b><span>Confianza {recommendation.confidenceLabel.toLowerCase()}</span></div></div>

      <div className={styles.kpis}>
        <article className={styles.primaryKpi}><span>Precio recomendado</span><strong>{money(selectedScenario.recommendedPrice)}</strong><small className={selectedScenario.priceChangePct <= 0 ? styles.positive : styles.warning}>{pct(selectedScenario.priceChangePct)} vs. precio actual</small></article>
        <article><span>Unidades proyectadas</span><strong>{number(selectedScenario.projectedUnits)}</strong><small className={selectedScenario.unitsChangePct >= 0 ? styles.positive : styles.warning}>{pct(selectedScenario.unitsChangePct)} vs. base</small></article>
        <article><span>Ingresos proyectados</span><strong>{money(selectedScenario.projectedRevenue)}</strong><small className={selectedScenario.revenueChangePct >= 0 ? styles.positive : styles.warning}>{pct(selectedScenario.revenueChangePct)}</small></article>
        <article><span>Utilidad bruta</span><strong>{money(selectedScenario.projectedGrossProfit)}</strong><small className={selectedScenario.grossProfitChangePct >= 0 ? styles.positive : styles.warning}>{pct(selectedScenario.grossProfitChangePct)} · margen {selectedScenario.projectedMarginPct}%</small></article>
      </div>

      <div className={styles.resultGrid}>
        <div className={styles.scenarioPanel}>
          <div className={styles.panelTitle}><div><span>COMPARADOR</span><h3>Tres estrategias de precio</h3></div></div>
          <div className={styles.scenarios}>{recommendation.scenarios.map((scenario) => <button key={scenario.objective} className={scenario.objective === selectedScenario.objective ? styles.scenarioActive : ""}>
            <span>{objectiveLabel(scenario.objective)}</span><strong>{money(scenario.recommendedPrice)}</strong><div><small>{number(scenario.projectedUnits)} unidades</small><small>{money(scenario.projectedGrossProfit)} utilidad</small></div>
          </button>)}</div>
          <div className={styles.marketBand}><div><span>Mínimo mercado</span><b>{money(recommendation.market.minimum)}</b></div><div><span>Promedio mercado</span><b>{money(recommendation.market.average)}</b></div><div><span>Máximo mercado</span><b>{money(recommendation.market.maximum)}</b></div></div>
        </div>

        <div className={styles.forecastPanel}>
          <div className={styles.panelTitle}><div><span>FORECAST</span><h3>Proyección de cuatro semanas</h3></div></div>
          <div className={styles.forecast}>{recommendation.forecast.map((week) => <div key={week.week}><span>Semana {week.week}</span><div><i style={{ width: `${Math.max(8, week.revenue / maximumForecast * 100)}%` }} /></div><b>{money(week.revenue)}</b><small>{number(week.units)} un.</small></div>)}</div>
        </div>
      </div>

      <div className={styles.rationalePanel}>
        <div className={styles.panelTitle}><div><span>EXPLICABILIDAD</span><h3>Por qué la IA recomienda este precio</h3></div></div>
        <div className={styles.rationale}>{recommendation.rationale.map((reason, index) => <div key={reason}><b>{String(index + 1).padStart(2, "0")}</b><span>{reason}</span></div>)}</div>
      </div>
    </>}

    {history.length > 0 && <div className={styles.historyPanel}>
      <div className={styles.panelTitle}><div><span>HISTORIAL</span><h3>Últimas simulaciones guardadas</h3></div><b>{history.length}</b></div>
      <div className={styles.historyTable}>{history.slice(0, 8).map((item) => <div key={item.id}><div><strong>{item.product_name}</strong><span>{objectiveLabel(item.objective)} · {new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</span></div><span>{money(item.current_price)} → <b>{money(item.recommended_price)}</b></span><span>{money(item.projected_gross_profit)} utilidad</span></div>)}</div>
    </div>}
  </section>;
}
