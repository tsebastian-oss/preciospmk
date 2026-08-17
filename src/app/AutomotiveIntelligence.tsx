"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AutomotiveIntelligence.module.css";

type AutomotiveOptions = {
  source: "clickhouse";
  brands: string[];
  models: { brand: string; model: string }[];
  dealers: string[];
  singleSourcePerBrand?: boolean;
};

type AutomotiveVehicle = {
  id: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  listPrice: number;
  brandBonus: number;
  onlineBonus: number;
  dealerBonus: number;
  cashPrice: number;
  financeBonus: number;
  finalPrice: number;
  observedAt: string | null;
};

type AutomotivePayload = {
  source: "clickhouse";
  sourcePolicy?: "single_source_per_brand";
  summary: {
    brands: number;
    models: number;
    versions: number;
    dealers: number;
    lastObservedAt: string | null;
  };
  vehicles: AutomotiveVehicle[];
};

type Grade = "entry" | "mid" | "top";
type AutomotiveView = "catalog" | "variations" | "brand_variations";
type BrandComparison = "previous_week" | "previous_month";

type VariationRow = {
  id: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  grade: Grade;
  currentPrice: number;
  previousPrice: number;
  absoluteChange: number | null;
  percentageChange: number | null;
  observedAt: string | null;
  previousObservedAt: string | null;
};

type VariationSummary = {
  models: number;
  comparableModels: number;
  currentAverage: number;
  previousAverage: number;
  absoluteChange: number;
  percentageChange: number | null;
};

type VariationsPayload = {
  source: "clickhouse";
  sourcePolicy: "single_source_per_brand";
  comparison: "previous_week";
  gradeMethod: "price_rank_per_model";
  summaries: Record<Grade, VariationSummary>;
  rows: VariationRow[];
};

type BrandVariationRow = {
  brand: string;
  dealer: string;
  currentAverage: number;
  previousAverage: number;
  absoluteChange: number;
  percentageChange: number | null;
  versions: number;
  comparableVersions: number;
  increasedVersions: number;
  decreasedVersions: number;
  unchangedVersions: number;
  observedAt: string | null;
  previousObservedAt: string | null;
};

type BrandVariationPayload = {
  source: "clickhouse";
  sourcePolicy: "single_source_per_brand";
  comparison: BrandComparison;
  comparisonLabel: "semana pasada" | "mes pasado";
  methodology: "same_version_same_source";
  summary: {
    brands: number;
    comparableBrands: number;
    brandsUp: number;
    brandsDown: number;
    brandsStable: number;
    marketPercentageChange: number | null;
    marketAbsoluteChange: number;
    highestIncrease: { brand: string; percentageChange: number | null } | null;
    biggestDecrease: { brand: string; percentageChange: number | null } | null;
  };
  rows: BrandVariationRow[];
};

type AiSummary = {
  answer: string;
  model: string;
  ai: true;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

function formatPrice(value: number) {
  return value > 0 ? money.format(value) : "—";
}

function formatBonus(value: number) {
  return value > 0 ? `-${money.format(value)}` : "—";
}

function formatSignedMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1) return money.format(0);
  return `${value > 0 ? "+" : "-"}${money.format(Math.abs(value))}`;
}

function formatPercentage(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < .005 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function variationClass(value: number | null | undefined) {
  if (value === null || value === undefined || Math.abs(value) < .005) return styles.neutralVariation;
  return value > 0 ? styles.upVariation : styles.downVariation;
}

function shortBrand(value: string) {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value;
}

const GRADE_COPY: Record<Grade, { label: string; description: string }> = {
  entry: { label: "Entry Versions", description: "Versión de menor precio vigente de cada modelo." },
  mid: { label: "Mid Grades", description: "Versión mediana por precio cuando el modelo tiene al menos tres versiones." },
  top: { label: "Topes de línea", description: "Versión de mayor precio vigente de cada modelo." },
};

const VIEW_COPY: Record<AutomotiveView, { title: string; description: string }> = {
  catalog: {
    title: "Mercado automotriz",
    description: "Modelo, versión y estructura de precio con una única fuente prioritaria por marca.",
  },
  variations: {
    title: "Variaciones de precio",
    description: "Compara Entry Versions, Mid Grades y Topes de línea contra la semana anterior usando la misma versión y la misma fuente.",
  },
  brand_variations: {
    title: "Variación por marca",
    description: "Lectura ejecutiva del movimiento promedio de precios por marca, comparable contra la semana o el mes anterior.",
  },
};

export default function AutomotiveIntelligence() {
  const [options, setOptions] = useState<AutomotiveOptions | null>(null);
  const [payload, setPayload] = useState<AutomotivePayload | null>(null);
  const [variations, setVariations] = useState<VariationsPayload | null>(null);
  const [brandVariations, setBrandVariations] = useState<BrandVariationPayload | null>(null);
  const [view, setView] = useState<AutomotiveView>("catalog");
  const [grade, setGrade] = useState<Grade>("entry");
  const [comparison, setComparison] = useState<BrandComparison>("previous_week");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [dealer, setDealer] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/automotive?options=1", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("options_failed");
        return await response.json() as AutomotiveOptions;
      })
      .then((value) => { if (active) setOptions(value); })
      .catch(() => { if (active) setError("No fue posible cargar los filtros automotrices."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (view === "variations") params.set("mode", "variations");
    if (view === "brand_variations") {
      params.set("mode", "brand_variations");
      params.set("comparison", comparison);
    }
    if (brand) params.set("brand", brand);
    if (model) params.set("model", model);
    if (dealer) params.set("dealer", dealer);

    fetch(`/api/automotive?${params.toString()}`, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("automotive_failed");
        return await response.json() as AutomotivePayload | VariationsPayload | BrandVariationPayload;
      })
      .then((value) => {
        if (!active) return;
        if (view === "variations") setVariations(value as VariationsPayload);
        else if (view === "brand_variations") setBrandVariations(value as BrandVariationPayload);
        else setPayload(value as AutomotivePayload);
      })
      .catch((cause) => {
        if (active && (cause as Error)?.name !== "AbortError") setError("No fue posible cargar la inteligencia automotriz desde ClickHouse.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [view, comparison, brand, model, dealer]);

  useEffect(() => {
    if (view !== "brand_variations" || !brandVariations) return;
    const rows = brandVariations.rows.filter((row) => row.percentageChange !== null);
    setAiSummary(null);
    setAiError("");
    if (!rows.length) return;

    const controller = new AbortController();
    let active = true;
    setAiLoading(true);
    fetch("/api/automotive/brand-summary", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comparison, rows }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("ai_summary_failed");
        return await response.json() as AiSummary;
      })
      .then((value) => { if (active) setAiSummary(value); })
      .catch((cause) => {
        if (active && (cause as Error)?.name !== "AbortError") setAiError("El gráfico está disponible, pero el resumen OpenAI no pudo generarse en este momento.");
      })
      .finally(() => { if (active) setAiLoading(false); });

    return () => { active = false; controller.abort(); };
  }, [view, comparison, brandVariations]);

  const models = useMemo(() => {
    const rows = options?.models ?? [];
    return rows.filter((item) => !brand || item.brand === brand);
  }, [options, brand]);

  useEffect(() => {
    if (model && !models.some((item) => item.model === model)) setModel("");
  }, [model, models]);

  const summary = payload?.summary;
  const vehicles = payload?.vehicles ?? [];
  const variationRows = (variations?.rows ?? []).filter((row) => row.grade === grade);
  const variationSummary = variations?.summaries?.[grade];
  const gradeCopy = GRADE_COPY[grade];
  const brandRows = brandVariations?.rows ?? [];
  const comparableBrandRows = brandRows.filter((row) => row.percentageChange !== null);
  const brandSummary = brandVariations?.summary;
  const viewCopy = VIEW_COPY[view];
  const previousPeriodLabel = comparison === "previous_month" ? "Mes anterior" : "Semana anterior";
  const chartMax = Math.max(1, ...comparableBrandRows.map((row) => Math.abs(row.percentageChange ?? 0)));
  const chartWidth = Math.max(760, comparableBrandRows.length * 76 + 90);
  const chartBaseline = 145;
  const chartAmplitude = 108;

  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <span>AUTOMOTIVE INTELLIGENCE · CHILE</span>
        <h1>{viewCopy.title}</h1>
        <p>{viewCopy.description}</p>
      </div>
      <div className={styles.sourcePill}><i /> 1 fuente por marca · Dealer-first · ClickHouse</div>
    </div>

    <nav className={styles.subnav} aria-label="Inteligencia automotriz">
      <button type="button" className={view === "catalog" ? styles.subnavActive : ""} onClick={() => setView("catalog")}>Mercado automotriz</button>
      <button type="button" className={view === "variations" ? styles.subnavActive : ""} onClick={() => setView("variations")}>Variaciones de precio</button>
      <button type="button" className={view === "brand_variations" ? styles.subnavActive : ""} onClick={() => setView("brand_variations")}>Variación por marca</button>
    </nav>

    <div className={`${styles.filters} ${view === "brand_variations" ? styles.filtersWithComparison : ""}`}>
      <label>Marca
        <select value={brand} onChange={(event) => { setBrand(event.target.value); setModel(""); }}>
          <option value="">Todas las marcas</option>
          {(options?.brands ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>Modelo
        <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!brand && models.length === 0}>
          <option value="">Todos los modelos</option>
          {models.map((item) => <option key={`${item.brand}:${item.model}`} value={item.model}>{item.model}</option>)}
        </select>
      </label>
      <label>Fuente prioritaria
        <select value={dealer} onChange={(event) => setDealer(event.target.value)}>
          <option value="">Todas las fuentes</option>
          {(options?.dealers ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {view === "brand_variations" ? <label>Comparar contra
        <select value={comparison} onChange={(event) => setComparison(event.target.value as BrandComparison)}>
          <option value="previous_week">Semana pasada</option>
          <option value="previous_month">Mes pasado</option>
        </select>
      </label> : null}
      <button type="button" className={styles.clear} onClick={() => { setBrand(""); setModel(""); setDealer(""); }}>Limpiar</button>
    </div>

    {view === "catalog" ? <>
      <div className={styles.summary}>
        <div className={styles.metric}><span>Marcas</span><strong>{integer.format(summary?.brands ?? 0)}</strong><small>una fuente por marca</small></div>
        <div className={styles.metric}><span>Modelos</span><strong>{integer.format(summary?.models ?? 0)}</strong><small>normalizados</small></div>
        <div className={styles.metric}><span>Versiones / ofertas</span><strong>{integer.format(summary?.versions ?? 0)}</strong><small>sin duplicar fuentes</small></div>
        <div className={styles.metric}><span>Fuentes</span><strong>{integer.format(summary?.dealers ?? 0)}</strong><small>prioritarias activas</small></div>
        <div className={styles.metric}><span>Última captura</span><strong>{summary?.lastObservedAt ? new Date(summary.lastObservedAt).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—"}</strong><small>histórico automático</small></div>
      </div>

      <div className={styles.sectionHeader}>
        <div><h2>Modelos y versiones</h2><p>Ordenados por menor precio final observado y depurados a una sola fuente por marca.</p></div>
        <b>{integer.format(vehicles.length)} resultados</b>
      </div>

      {loading ? <div className={styles.loading}>Cargando catálogo desde ClickHouse…</div> : null}
      {!loading && error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !error && vehicles.length === 0 ? <div className={styles.empty}>
        <strong>No hay precios para esta combinación.</strong>
        <p>La fuente prioritaria puede estar todavía en proceso de integración o captura.</p>
      </div> : null}

      {!loading && !error && vehicles.length > 0 ? <div className={styles.tableShell}>
        <table className={styles.table}>
          <thead><tr>
            <th>Modelo</th><th>Versión</th><th>Fuente</th><th>Precio lista</th><th>Bono marca</th><th>Bonos adicionales</th><th>Precio contado</th><th>Bono financiamiento</th><th>Precio final</th>
          </tr></thead>
          <tbody>{vehicles.map((vehicle) => {
            const extraBonus = vehicle.onlineBonus + vehicle.dealerBonus;
            return <tr key={vehicle.id}>
              <td className={styles.modelCell}><small>{vehicle.brand}</small><strong>{vehicle.model}</strong></td>
              <td className={styles.versionCell}>{vehicle.version}</td>
              <td><span className={styles.dealer}>{vehicle.dealer}</span></td>
              <td>{formatPrice(vehicle.listPrice)}</td>
              <td className={styles.bonusCell}>{formatBonus(vehicle.brandBonus)}</td>
              <td className={styles.bonusCell}>{formatBonus(extraBonus)}</td>
              <td>{formatPrice(vehicle.cashPrice)}</td>
              <td className={styles.bonusCell}>{formatBonus(vehicle.financeBonus)}</td>
              <td className={styles.finalCell}>{formatPrice(vehicle.finalPrice)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div> : null}
    </> : null}

    {view === "variations" ? <>
      <div className={styles.gradeTabs}>
        {(Object.keys(GRADE_COPY) as Grade[]).map((value) => <button type="button" key={value} className={grade === value ? styles.gradeActive : ""} onClick={() => setGrade(value)}>
          <strong>{GRADE_COPY[value].label}</strong><span>{GRADE_COPY[value].description}</span>
        </button>)}
      </div>

      <div className={styles.summary}>
        <div className={styles.metric}><span>Precio promedio hoy</span><strong>{formatPrice(variationSummary?.currentAverage ?? 0)}</strong><small>{gradeCopy.label}</small></div>
        <div className={styles.metric}><span>Semana anterior</span><strong>{formatPrice(variationSummary?.previousAverage ?? 0)}</strong><small>mismas versiones comparables</small></div>
        <div className={styles.metric}><span>Variación promedio</span><strong className={variationClass(variationSummary?.absoluteChange)}>{formatSignedMoney(variationSummary?.comparableModels ? variationSummary.absoluteChange : null)}</strong><small>vs semana anterior</small></div>
        <div className={styles.metric}><span>Variación %</span><strong className={variationClass(variationSummary?.percentageChange)}>{formatPercentage(variationSummary?.percentageChange)}</strong><small>promedio comparable</small></div>
        <div className={styles.metric}><span>Modelos</span><strong>{integer.format(variationSummary?.models ?? 0)}</strong><small>{integer.format(variationSummary?.comparableModels ?? 0)} con histórico semanal</small></div>
      </div>

      <div className={styles.sectionHeader}>
        <div><h2>{gradeCopy.label}</h2><p>{gradeCopy.description} La comparación usa la última observación disponible dentro de la semana calendario anterior (lunes a domingo).</p></div>
        <b>{integer.format(variationRows.length)} modelos</b>
      </div>

      {loading ? <div className={styles.loading}>Calculando variaciones semanales…</div> : null}
      {!loading && error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !error && variationRows.length === 0 ? <div className={styles.empty}>
        <strong>Todavía no hay versiones comparables para este nivel.</strong>
        <p>Las versiones con “Precio desde” no se usan para Entry, Mid ni Tope. Una versión se compara solo cuando existe una observación de esa misma versión y fuente dentro de la semana calendario anterior.</p>
      </div> : null}

      {!loading && !error && variationRows.length > 0 ? <div className={styles.tableShell}>
        <table className={`${styles.table} ${styles.variationTable}`}>
          <thead><tr><th>Marca</th><th>Modelo</th><th>Versión</th><th>Fuente</th><th>Precio hoy</th><th>Semana anterior</th><th>Variación</th><th>Variación %</th></tr></thead>
          <tbody>{variationRows.map((row) => <tr key={`${row.grade}:${row.id}`}>
            <td><strong>{row.brand}</strong></td>
            <td className={styles.modelCell}><strong>{row.model}</strong></td>
            <td className={styles.versionCell}>{row.version}</td>
            <td><span className={styles.dealer}>{row.dealer}</span></td>
            <td className={styles.finalCell}>{formatPrice(row.currentPrice)}</td>
            <td>{formatPrice(row.previousPrice)}</td>
            <td className={variationClass(row.absoluteChange)}>{formatSignedMoney(row.absoluteChange)}</td>
            <td className={variationClass(row.percentageChange)}>{formatPercentage(row.percentageChange)}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}
    </> : null}

    {view === "brand_variations" ? <>
      <div className={styles.summary}>
        <div className={styles.metric}><span>Marcas al alza</span><strong className={styles.upVariation}>{integer.format(brandSummary?.brandsUp ?? 0)}</strong><small>de {integer.format(brandSummary?.comparableBrands ?? 0)} comparables</small></div>
        <div className={styles.metric}><span>Marcas a la baja</span><strong className={styles.downVariation}>{integer.format(brandSummary?.brandsDown ?? 0)}</strong><small>{integer.format(brandSummary?.brandsStable ?? 0)} estables</small></div>
        <div className={styles.metric}><span>Variación mercado</span><strong className={variationClass(brandSummary?.marketPercentageChange)}>{formatPercentage(brandSummary?.marketPercentageChange)}</strong><small>promedio simple entre marcas</small></div>
        <div className={styles.metric}><span>Mayor alza</span><strong className={styles.upVariation}>{brandSummary?.highestIncrease?.brand ?? "—"}</strong><small>{formatPercentage(brandSummary?.highestIncrease?.percentageChange)}</small></div>
        <div className={styles.metric}><span>Mayor caída</span><strong className={styles.downVariation}>{brandSummary?.biggestDecrease?.brand ?? "—"}</strong><small>{formatPercentage(brandSummary?.biggestDecrease?.percentageChange)}</small></div>
      </div>

      <div className={styles.sectionHeader}>
        <div>
          <h2>Movimiento promedio por marca</h2>
          <p>Mismas versiones y misma fuente. Comparación contra {comparison === "previous_month" ? "el mes calendario anterior" : "la semana calendario anterior"}.</p>
        </div>
        <b>{integer.format(comparableBrandRows.length)} marcas comparables</b>
      </div>

      {loading ? <div className={styles.loading}>Calculando variación por marca…</div> : null}
      {!loading && error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !error && comparableBrandRows.length === 0 ? <div className={styles.empty}>
        <strong>No hay suficiente histórico comparable para este período.</strong>
        <p>{comparison === "previous_month" ? "Aún no hay capturas suficientes dentro del mes calendario anterior." : "No encontramos capturas de las mismas versiones dentro de la semana calendario anterior."}</p>
      </div> : null}

      {!loading && !error && comparableBrandRows.length > 0 ? <div className={styles.chartShell}>
        <div className={styles.chartLegend}>
          <span><i className={styles.legendUp} /> Aumento de precio</span>
          <span><i className={styles.legendDown} /> Disminución de precio</span>
          <span><i className={styles.legendNeutral} /> Sin cambio</span>
        </div>
        <div className={styles.chartScroller}>
          <svg className={styles.brandChart} width={chartWidth} height="310" viewBox={`0 0 ${chartWidth} 310`} role="img" aria-label="Variación promedio de precios por marca">
            <line x1="34" x2={chartWidth - 20} y1={chartBaseline} y2={chartBaseline} className={styles.zeroLine} />
            <text x="8" y={chartBaseline + 4} className={styles.zeroLabel}>0%</text>
            {comparableBrandRows.map((row, index) => {
              const value = row.percentageChange ?? 0;
              const height = Math.max(2, Math.abs(value) / chartMax * chartAmplitude);
              const x = 48 + index * 76;
              const y = value >= 0 ? chartBaseline - height : chartBaseline;
              const valueY = value >= 0 ? y - 8 : Math.min(278, y + height + 16);
              const barClass = Math.abs(value) < .005 ? styles.chartBarNeutral : value > 0 ? styles.chartBarUp : styles.chartBarDown;
              return <g key={`${row.brand}:${row.dealer}`}>
                <title>{`${row.brand}: ${formatPercentage(value)} vs ${brandVariations?.comparisonLabel ?? "período anterior"} · ${row.comparableVersions} versiones comparables`}</title>
                <rect x={x} y={y} width="42" height={height} rx="2" className={barClass} />
                <text x={x + 21} y={valueY} textAnchor="middle" className={styles.chartValue}>{formatPercentage(value)}</text>
                <text x={x + 21} y="296" textAnchor="middle" className={styles.chartBrand}>{shortBrand(row.brand)}</text>
              </g>;
            })}
          </svg>
        </div>
      </div> : null}

      {!loading && !error && comparableBrandRows.length > 0 ? <div className={styles.aiPanel}>
        <div className={styles.aiHeader}>
          <div><span>OPENAI · MARKET ANALYST</span><h3>Resumen ejecutivo del mercado</h3></div>
          <b>{aiSummary?.model ?? "GPT-5.6"}</b>
        </div>
        {aiLoading ? <div className={styles.aiLoading}>Analizando movimientos de precio por marca…</div> : null}
        {!aiLoading && aiError ? <div className={styles.aiError}>{aiError}</div> : null}
        {!aiLoading && !aiError && aiSummary ? <div className={styles.aiText}>{aiSummary.answer}</div> : null}
      </div> : null}

      {!loading && !error && brandRows.length > 0 ? <>
        <div className={styles.sectionHeader}>
          <div><h2>Detalle por marca</h2><p>El promedio comparable usa exactamente el mismo set de versiones en ambos períodos.</p></div>
          <b>{integer.format(brandRows.length)} marcas</b>
        </div>
        <div className={styles.tableShell}>
          <table className={`${styles.table} ${styles.brandVariationTable}`}>
            <thead><tr><th>Marca</th><th>Fuente</th><th>Precio promedio hoy</th><th>{previousPeriodLabel}</th><th>Variación</th><th>Variación %</th><th>Versiones comparables</th><th>Suben / Bajan / Estables</th></tr></thead>
            <tbody>{brandRows.map((row) => <tr key={`${row.brand}:${row.dealer}`}>
              <td><strong>{row.brand}</strong></td>
              <td><span className={styles.dealer}>{row.dealer}</span></td>
              <td className={styles.finalCell}>{formatPrice(row.currentAverage)}</td>
              <td>{formatPrice(row.previousAverage)}</td>
              <td className={variationClass(row.percentageChange)}>{row.percentageChange === null ? "—" : formatSignedMoney(row.absoluteChange)}</td>
              <td className={variationClass(row.percentageChange)}>{formatPercentage(row.percentageChange)}</td>
              <td>{integer.format(row.comparableVersions)} / {integer.format(row.versions)}</td>
              <td><span className={styles.movementCounts}><b>↑ {row.increasedVersions}</b><i>↓ {row.decreasedVersions}</i><em>= {row.unchangedVersions}</em></span></td>
            </tr>)}</tbody>
          </table>
        </div>
      </> : null}
    </> : null}
  </section>;
}
