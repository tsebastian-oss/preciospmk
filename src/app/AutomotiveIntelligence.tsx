"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AutomotiveIntelligence.module.css";

type AutomotiveOptions = {
  source: "clickhouse";
  brands: string[];
  models: { brand: string; model: string }[];
  dealers: string[];
};

type AutomotiveVehicle = {
  id: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  bodyType: string;
  imageUrl: string | null;
  url: string;
  listPrice: number;
  brandBonus: number;
  onlineBonus: number;
  dealerBonus: number;
  cashPrice: number;
  financeBonus: number;
  finalPrice: number;
  fuelType: string | null;
  technicalSheetUrl: string | null;
  observedAt: string | null;
};

type AutomotivePayload = {
  source: "clickhouse";
  summary: {
    brands: number;
    models: number;
    versions: number;
    dealers: number;
    lastObservedAt: string | null;
  };
  vehicles: AutomotiveVehicle[];
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

function formatPrice(value: number) {
  return value > 0 ? money.format(value) : "—";
}

function bonusLabel(label: string, value: number) {
  if (!value) return null;
  return <span className={styles.bonus}>{label}: -{money.format(value)}</span>;
}

export default function AutomotiveIntelligence() {
  const [options, setOptions] = useState<AutomotiveOptions | null>(null);
  const [payload, setPayload] = useState<AutomotivePayload | null>(null);
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
    if (brand) params.set("brand", brand);
    if (model) params.set("model", model);
    if (dealer) params.set("dealer", dealer);
    fetch(`/api/automotive?${params.toString()}`, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalog_failed");
        return await response.json() as AutomotivePayload;
      })
      .then((value) => setPayload(value))
      .catch((cause) => {
        if ((cause as Error)?.name !== "AbortError") setError("No fue posible cargar el catálogo automotriz desde ClickHouse.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [brand, model, dealer]);

  const models = useMemo(() => {
    const rows = options?.models ?? [];
    return rows.filter((item) => !brand || item.brand === brand);
  }, [options, brand]);

  useEffect(() => {
    if (model && !models.some((item) => item.model === model)) setModel("");
  }, [model, models]);

  const summary = payload?.summary;
  const vehicles = payload?.vehicles ?? [];

  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <span>AUTOMOTIVE INTELLIGENCE · CHILE</span>
        <h1>Mercado automotriz</h1>
        <p>Catálogo de marcas, modelos y versiones construido desde concesionarios. Compara precio lista, bonos y precio final sin depender únicamente de las páginas corporativas de cada marca.</p>
      </div>
      <div className={styles.sourcePill}><i /> Dealer-first · ClickHouse</div>
    </div>

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
      <label>Concesionario
        <select value={dealer} onChange={(event) => setDealer(event.target.value)}>
          <option value="">Todos los concesionarios</option>
          {(options?.dealers ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button className={styles.clear} onClick={() => { setBrand(""); setModel(""); setDealer(""); }}>Limpiar</button>
    </div>

    <div className={styles.summary}>
      <div className={styles.metric}><span>Marcas</span><strong>{integer.format(summary?.brands ?? 0)}</strong><small>con precio observado</small></div>
      <div className={styles.metric}><span>Modelos</span><strong>{integer.format(summary?.models ?? 0)}</strong><small>normalizados</small></div>
      <div className={styles.metric}><span>Versiones / ofertas</span><strong>{integer.format(summary?.versions ?? 0)}</strong><small>por concesionario</small></div>
      <div className={styles.metric}><span>Concesionarios</span><strong>{integer.format(summary?.dealers ?? 0)}</strong><small>fuentes activas</small></div>
      <div className={styles.metric}><span>Última captura</span><strong>{summary?.lastObservedAt ? new Date(summary.lastObservedAt).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—"}</strong><small>lunes / viernes</small></div>
    </div>

    <div className={styles.sectionHeader}>
      <div><h2>Modelos y versiones</h2><p>Ordenados por menor precio final observado.</p></div>
      <b>{integer.format(vehicles.length)} resultados</b>
    </div>

    {loading ? <div className={styles.loading}>Cargando catálogo desde ClickHouse…</div> : null}
    {!loading && error ? <div className={styles.error}>{error}</div> : null}
    {!loading && !error && vehicles.length === 0 ? <div className={styles.empty}>
      <strong>La vertical Automotriz está lista para recibir catálogo.</strong>
      <p>Las primeras fuentes son concesionarios multimarca. A medida que los scrapers completen sus rondas de lunes y viernes aparecerán aquí marcas, modelos, versiones, bonos, imágenes y fichas técnicas.</p>
    </div> : null}

    {!loading && !error && vehicles.length > 0 ? <div className={styles.grid}>{vehicles.map((vehicle) => <article key={vehicle.id} className={styles.card}>
      <div className={styles.image}>
        {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt={`${vehicle.brand} ${vehicle.model}`} loading="lazy" /> : <span className={styles.placeholder}>Imagen no disponible</span>}
        <span className={styles.dealer}>{vehicle.dealer}</span>
      </div>
      <div className={styles.content}>
        <div className={styles.identity}>
          <span>{vehicle.brand}</span>
          <h3>{vehicle.model}</h3>
          <p>{vehicle.version}{vehicle.fuelType ? ` · ${vehicle.fuelType}` : ""}{vehicle.bodyType ? ` · ${vehicle.bodyType}` : ""}</p>
        </div>
        <div className={styles.prices}>
          <div className={styles.price}><span>Precio lista</span><strong>{formatPrice(vehicle.listPrice)}</strong></div>
          <div className={styles.price}><span>Precio contado</span><strong>{formatPrice(vehicle.cashPrice)}</strong></div>
          <div className={styles.price}><span>Bono financiamiento</span><strong>{vehicle.financeBonus ? `-${money.format(vehicle.financeBonus)}` : "—"}</strong></div>
          <div className={`${styles.price} ${styles.final}`}><span>Precio final</span><strong>{formatPrice(vehicle.finalPrice)}</strong></div>
        </div>
        <div className={styles.bonuses}>
          {bonusLabel("Bono marca", vehicle.brandBonus)}
          {bonusLabel("Bono online", vehicle.onlineBonus)}
          {bonusLabel("Bono concesionario", vehicle.dealerBonus)}
        </div>
        <div className={styles.actions}>
          {vehicle.url ? <a href={vehicle.url} target="_blank" rel="noreferrer">Ver oferta</a> : null}
          {vehicle.technicalSheetUrl ? <a href={vehicle.technicalSheetUrl} target="_blank" rel="noreferrer">Ficha técnica</a> : null}
        </div>
      </div>
    </article>)}</div> : null}
  </section>;
}
