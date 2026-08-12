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
type AutomotiveView = "catalog" | "variations";

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

const GRADE_COPY: Record<Grade, { label: string; description: string }> = {
  entry: { label: "Entry Versions", description: "Versión de menor precio vigente de cada modelo." },
  mid: { label: "Mid Grades", description: "Versión mediana por precio cuando el modelo tiene al menos tres versiones." },
  top: { label: "Topes de línea", description: "Versión de mayor precio vigente de cada modelo." },
};

export default function AutomotiveIntelligence() {
  const [options, setOptions] = useState<AutomotiveOptions | null>(null);
  const [payload, setPayload] = useState<AutomotivePayload | null>(null);
  const [variations, setVariations] = useState<VariationsPayload | null>(null);
  const [view, setView] = useState<AutomotiveView>("catalog");
  const [grade, setGrade] = useState<Grade>("entry");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [dealer, setDealer] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (view === "variations") params.set("mode", "variations");
    if (brand) params.set("brand", brand);
    if (model) params.set("model", model);
    if (dealer) params.set("dealer", dealer);
    fetch(`/api/automotive?${params.toString()}`, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("automotive_failed");
        return await response.json() as AutomotivePayload | VariationsPayload;
      })
      .then((value) => {
        if (view === "variations") setVariations(value as VariationsPayload);
        else setPayload(value as AutomotivePayload);
      })
      .catch((cause) => {
        if ((cause as Error)?.name !== "AbortError") setError("No fue posible cargar la inteligencia automotriz desde ClickHouse.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [view, brand, model, dealer]);

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

  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <span>AUTOMOTIVE INTELLIGENCE · CHILE</span>
        <h1>{view === "catalog" ? "Mercado automotriz" : "Variaciones de precio"}</h1>
        <p>{view === "catalog"
          ? "Modelo, versión y estructura de precio con una única fuente prioritaria por marca."
          : "Compara Entry Versions, Mid Grades y Topes de línea contra la semana anterior usando la misma versión y la misma fuente."}</p>
      </div>
      <div className={styles.sourcePill}><i /> 1 fuente por marca · ClickHouse</div>
    </div>

    <nav className={styles.subnav} aria-label="Inteligencia automotriz">
      <button className={view === "catalog" ? styles.subnavActive : ""} onClick={() => setView("catalog")}>Mercado automotriz</button>
      <button className={view === "variations" ? styles.subnavActive : ""} onClick={() => setView("variations")}>Variaciones de precio</button>
    </nav>

    <div className={styles.filters}>
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
      <button className={styles.clear} onClick={() => { setBrand(""); setModel(""); setDealer(""); }}>Limpiar</button>
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
    </> : <>
      <div className={styles.gradeTabs}>
        {(Object.keys(GRADE_COPY) as Grade[]).map((value) => <button key={value} className={grade === value ? styles.gradeActive : ""} onClick={() => setGrade(value)}>
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
        <div><h2>{gradeCopy.label}</h2><p>{gradeCopy.description} La comparación busca la última observación disponible entre 6 y 10 días atrás.</p></div>
        <b>{integer.format(variationRows.length)} modelos</b>
      </div>

      {loading ? <div className={styles.loading}>Calculando variaciones semanales…</div> : null}
      {!loading && error ? <div className={styles.error}>{error}</div> : null}
      {!loading && !error && variationRows.length === 0 ? <div className={styles.empty}>
        <strong>Todavía no hay versiones comparables para este nivel.</strong>
        <p>Las versiones con “Precio desde” no se usan para Entry, Mid ni Tope. El histórico semanal aparecerá a medida que se acumulen nuevas capturas.</p>
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
    </>}
  </section>;
}
