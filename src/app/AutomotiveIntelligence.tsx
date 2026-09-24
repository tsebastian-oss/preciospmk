"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AutomotiveIntelligence.module.css";
import AutomotiveFinancing from "./AutomotiveFinancing";

type AutomotiveOptions = {
  source: "supabase";
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
  source: "supabase";
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
type AutomotiveView = "catalog" | "variations" | "brand_variations" | "monthly" | "financing" | "downloads";
type PriceType = "final" | "cash" | "list";
type MonthlyPoint = {
  month: string;
  percentageChange: number | null;
  averagePrice: number | null;
  brands: number;
  versions: number;
  comparableBrands: number;
  comparableVersions: number;
  observations: number;
  isPartial: boolean;
};
type MonthlyPayload = { months: MonthlyPoint[]; methodology: string };
const PRICE_LABELS: Record<PriceType, string> = { final: "Precio final publicado", cash: "Precio contado", list: "Precio lista" };
function monthLabel(month: string) {
  return new Date(`${month.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("es-CL", { month: "short", year: "numeric", timeZone: "UTC" });
}
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
  source: "supabase";
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
  source: "supabase";
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
  financing: {
    title: "Financiamiento",
    description: "Compara financieras automotrices y tarjetas de crédito con tasas, CAE, cuotas, bonos y costo total bajo un mismo escenario.",
  },
  monthly: {
    title: "Evolución mensual de precios",
    description: "Sigue la variación promedio de la industria observada, mes a mes, con versiones y fuentes comparables.",
  },
  downloads: {
    title: "Bases de datos e históricos",
    description: "Descarga las capturas históricas completas en Excel para realizar tus propios análisis.",
  },
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
  const [monthly, setMonthly] = useState<MonthlyPayload | null>(null);
  const [priceType, setPriceType] = useState<PriceType>("final");
  const [downloading, setDownloading] = useState<"all" | "filtered" | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [downloadSuccess, setDownloadSuccess] = useState("");
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
    if (view === "downloads" || view === "financing") { setLoading(false); setError(""); return; }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (view === "monthly") {
      params.set("mode", "monthly");
      params.set("priceType", priceType);
    }
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
        return await response.json() as AutomotivePayload | VariationsPayload | BrandVariationPayload | MonthlyPayload;
      })
      .then((value) => {
        if (!active) return;
        if (view === "monthly") setMonthly(value as MonthlyPayload);
        else if (view === "variations") setVariations(value as VariationsPayload);
        else if (view === "brand_variations") setBrandVariations(value as BrandVariationPayload);
        else setPayload(value as AutomotivePayload);
      })
      .catch((cause) => {
        if (active && (cause as Error)?.name !== "AbortError") setError("No fue posible cargar la inteligencia automotriz desde Supabase.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [view, comparison, brand, model, dealer, priceType]);

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

  const monthlyPoints = monthly?.months ?? [];
  const lastMonth = monthlyPoints.at(-1);
  const monthlyScale = Math.max(1, ...monthlyPoints.map((point) => Math.abs(point.percentageChange ?? 0)));
  const monthlyWidth = Math.max(760, monthlyPoints.length * 92 + 80);
  const monthX = (index: number) => 74 + index * ((monthlyWidth - 120) / Math.max(1, monthlyPoints.length - 1));
  const monthY = (value: number) => 150 - value / monthlyScale * 98;
  const hasFilters = Boolean(brand || model || dealer);

  async function downloadHistory(scope: "all" | "filtered") {
    setDownloading(scope);
    setDownloadError("");
    setDownloadSuccess("");
    try {
      const params = new URLSearchParams({ scope });
      if (scope === "filtered") {
        if (brand) params.set("brand", brand);
        if (model) params.set("model", model);
        if (dealer) params.set("dealer", dealer);
      }
      const response = await fetch(`/api/automotive/export?${params}`, { credentials: "same-origin" });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(problem?.message || "No fue posible generar el Excel. Intenta nuevamente.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `automotriz-historico-${scope === "all" ? "completo" : "filtrado"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloadSuccess("Excel generado. Revisa las descargas de tu navegador.");
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "No fue posible descargar el histórico.");
    } finally { setDownloading(null); }
  }

  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <span>AUTOMOTIVE INTELLIGENCE · CHILE</span>
        <h1>{viewCopy.title}</h1>
        <p>{viewCopy.description}</p>
      </div>
      <div className={styles.sourcePill}><i /> {view === "downloads" ? "Histórico de todas las fuentes" : view === "financing" ? "Financieras + tarjetas · fuentes públicas" : "1 fuente prioritaria por marca"}</div>
    </div>

    <nav className={styles.subnav} aria-label="Inteligencia automotriz">
      <button type="button" className={view === "catalog" ? styles.subnavActive : ""} onClick={() => setView("catalog")}>Mercado automotriz</button>
      <button type="button" className={view === "variations" ? styles.subnavActive : ""} onClick={() => setView("variations")}>Variaciones de precio</button>
      <button type="button" className={view === "brand_variations" ? styles.subnavActive : ""} onClick={() => setView("brand_variations")}>Variación por marca</button>
      <button type="button" className={view === "monthly" ? styles.subnavActive : ""} onClick={() => setView("monthly")}>Evolución mensual</button>
      <button type="button" className={view === "financing" ? styles.subnavActive : ""} onClick={() => setView("financing")}>Financiamiento</button>
      <button type="button" className={view === "downloads" ? styles.subnavActive : ""} onClick={() => setView("downloads")}>Descargar bases</button>
    </nav>

    {view !== "financing" ? <div className={`${styles.filters} ${(view === "brand_variations" || view === "monthly") ? styles.filtersWithComparison : ""}`}>
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
      {view === "monthly" ? <label>Tipo de precio
        <select value={priceType} onChange={(event) => setPriceType(event.target.value as PriceType)}>
          {Object.entries(PRICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label> : null}
      <button type="button" className={styles.clear} onClick={() => { setBrand(""); setModel(""); setDealer(""); }}>Limpiar</button>
    </div> : null}

    {view === "financing" ? <AutomotiveFinancing vehicles={vehicles} /> : null}

    {view === "monthly" ? <>
      {loading ? <div className={styles.loading}>Construyendo evolución mensual con las capturas históricas…</div> : null}
      {!loading && error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !error && !monthlyPoints.length ? <div className={styles.empty}><strong>No hay capturas para estos filtros.</strong><p>El histórico se construye con lecturas reales del mercado. Los meses sin capturas no se estiman.</p></div> : null}
      {!loading && !error && monthlyPoints.length > 0 ? <>
        <div className={styles.summary}>
          <div className={styles.metric}><span>Último mes observado</span><strong>{lastMonth ? monthLabel(lastMonth.month) : "—"}</strong><small>{lastMonth?.isPartial ? "Mes en curso · datos parciales" : "Mes cerrado"}</small></div>
          <div className={styles.metric}><span>Variación mensual</span><strong className={variationClass(lastMonth?.percentageChange)}>{formatPercentage(lastMonth?.percentageChange)}</strong><small>vs mes calendario anterior</small></div>
          <div className={styles.metric}><span>Marcas comparables</span><strong>{integer.format(lastMonth?.comparableBrands ?? 0)} / {integer.format(lastMonth?.brands ?? 0)}</strong><small>cobertura del último mes</small></div>
          <div className={styles.metric}><span>Versiones comparables</span><strong>{integer.format(lastMonth?.comparableVersions ?? 0)} / {integer.format(lastMonth?.versions ?? 0)}</strong><small>misma versión y fuente</small></div>
          <div className={styles.metric}><span>Meses registrados</span><strong>{integer.format(monthlyPoints.filter((point) => point.observations > 0).length)}</strong><small>capturas reales del mercado</small></div>
        </div>
        <div className={styles.sectionHeader}><div><h2>{hasFilters ? "Evolución de la selección" : "Variación promedio de la industria observada"}</h2><p>{PRICE_LABELS[priceType]} · Variación porcentual respecto del mes anterior.</p></div></div>
        <div className={styles.chartShell}>
          <div className={styles.chartLegend}><span><i className={styles.legendMonthly} /> Variación mensual</span><span>○ Mes en curso</span><span>— Sin comparación disponible</span></div>
          <div className={styles.chartScroller}>
            <svg className={styles.brandChart} width={monthlyWidth} height="316" viewBox={`0 0 ${monthlyWidth} 316`} role="img" aria-label="Evolución de la variación promedio mensual de precios; detalle disponible en la tabla siguiente">
              {[-1, 0, 1].map((tick) => <g key={tick}><line x1="54" x2={monthlyWidth - 22} y1={monthY(tick * monthlyScale)} y2={monthY(tick * monthlyScale)} className={tick === 0 ? styles.zeroLine : styles.monthGrid} /><text x="45" y={monthY(tick * monthlyScale) + 4} textAnchor="end" className={styles.zeroLabel}>{formatPercentage(tick * monthlyScale)}</text></g>)}
              {monthlyPoints.map((point, index) => {
                const previous = monthlyPoints[index - 1];
                const value = point.percentageChange;
                const x = monthX(index);
                return <g key={point.month}>
                  <title>{`${monthLabel(point.month)}: ${formatPercentage(value)} · ${point.comparableBrands} marcas y ${point.comparableVersions} versiones comparables${point.isPartial ? " · Mes parcial" : ""}`}</title>
                  {value !== null && previous?.percentageChange != null ? <line x1={monthX(index - 1)} y1={monthY(previous.percentageChange)} x2={x} y2={monthY(value)} className={styles.monthLine} /> : null}
                  {value !== null ? <><circle cx={x} cy={monthY(value)} r="5" className={point.isPartial ? styles.monthPartial : styles.monthPoint} /><text x={x} y={monthY(value) - 14} textAnchor="middle" className={styles.chartValue}>{formatPercentage(value)}</text></> : <text x={x} y="267" textAnchor="middle" className={styles.zeroLabel}>Sin comparación</text>}
                  <text x={x} y="291" textAnchor="middle" className={styles.chartBrand}>{monthLabel(point.month)}{point.isPartial ? " *" : ""}</text>
                </g>;
              })}
            </svg>
          </div>
        </div>
        <p className={styles.methodology}>Cada mes utiliza la última captura disponible de cada versión y fuente. Se compara con el mes calendario inmediatamente anterior; la industria es el promedio simple de las variaciones por marca. No se pondera por ventas. Los cambios de fuente, versiones nuevas y precios faltantes quedan fuera de la comparación. El mes en curso es parcial y los meses sin comparación quedan vacíos.</p>
        {!monthlyPoints.some((point) => point.percentageChange !== null) ? <div className={styles.empty}><strong>Ya hay capturas; falta un segundo mes comparable.</strong><p>La curva aparecerá cuando existan observaciones de las mismas versiones y fuentes en meses consecutivos.</p></div> : null}
        <div className={styles.tableShell}><table className={`${styles.table} ${styles.monthTable}`}><thead><tr><th>Mes</th><th>Variación mensual</th><th>Precio medio observado</th><th>Marcas comparables / total</th><th>Versiones comparables / total</th><th>Capturas</th><th>Estado</th></tr></thead><tbody>{monthlyPoints.map((point) => <tr key={point.month}><td><strong>{monthLabel(point.month)}</strong></td><td className={variationClass(point.percentageChange)}>{formatPercentage(point.percentageChange)}</td><td>{formatPrice(point.averagePrice ?? 0)}</td><td>{integer.format(point.comparableBrands)} / {integer.format(point.brands)}</td><td>{integer.format(point.comparableVersions)} / {integer.format(point.versions)}</td><td>{integer.format(point.observations)}</td><td>{!point.observations ? "Sin capturas" : point.isPartial ? "Mes parcial" : "Mes cerrado"}</td></tr>)}</tbody></table></div>
        <p className={styles.methodology}>El precio final puede incluir condiciones comerciales o de financiamiento según la fuente. El precio contado solo se compara cuando está registrado explícitamente en ambas capturas. El precio medio observado describe la oferta capturada y puede cambiar por su composición; la variación mensual utiliza únicamente versiones comparables.</p>
      </> : null}
    </> : null}

    {view === "downloads" ? <>
      <div className={styles.downloadGrid}>
        <div className={styles.downloadCard}><span className={styles.downloadTag}>EXCEL · HISTÓRICO COMPLETO</span><h2>Todas las capturas del mercado</h2><p>Descarga todas las marcas, modelos, versiones y fuentes con sus observaciones históricas y estructura de precios. Incluye el historial disponible desde la primera captura, aunque cambie la fuente prioritaria.</p><p className={styles.downloadNote}>Esta descarga incluye todas las fechas y no aplica los filtros de la pantalla.</p><button type="button" className={styles.downloadButton} disabled={downloading !== null} onClick={() => void downloadHistory("all")}>{downloading === "all" ? "Generando Excel completo…" : "Descargar histórico completo (.xlsx)"}</button></div>
        <div className={styles.downloadCard}><span className={styles.downloadTag}>EXCEL · SELECCIÓN ACTUAL</span><h2>Histórico de tu selección</h2><p>Exporta todas las fechas disponibles para la marca, modelo y fuente que selecciones en los filtros superiores.</p><div className={styles.filterSelection}>{[brand, model, dealer].filter(Boolean).join(" · ") || "Selecciona al menos un filtro para preparar una base específica."}</div><button type="button" className={styles.downloadSecondary} disabled={downloading !== null || !hasFilters} onClick={() => void downloadHistory("filtered")}>{downloading === "filtered" ? "Generando Excel filtrado…" : "Descargar selección (.xlsx)"}</button></div>
      </div>
      <p className={styles.methodology}>Los históricos contienen las lecturas efectivamente capturadas. No se reconstruyen precios anteriores a la primera observación. La base crecerá con cada nueva corrida de captura.</p>
      {downloading ? <div className={styles.loading} role="status">Preparando el archivo con todas las observaciones. La descarga comenzará al terminar.</div> : null}
      {downloadError ? <div className={styles.error} role="alert">{downloadError}</div> : null}
      {downloadSuccess ? <div className={styles.downloadSuccess} role="status">{downloadSuccess}</div> : null}
    </> : null}

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

      {loading ? <div className={styles.loading}>Cargando mercado automotriz desde Supabase…</div> : null}
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
