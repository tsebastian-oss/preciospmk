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

function formatBonus(value: number) {
  return value > 0 ? `-${money.format(value)}` : "—";
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
        <p>Modelo, versión, concesionario y estructura de precio observada directamente en concesionarios chilenos.</p>
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
      <div className={styles.metric}><span>Concesionarios</span><strong>{integer.format(summary?.dealers ?? 0)}</strong><small>fuentes con datos</small></div>
      <div className={styles.metric}><span>Última captura</span><strong>{summary?.lastObservedAt ? new Date(summary.lastObservedAt).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—"}</strong><small>lunes / viernes</small></div>
    </div>

    <div className={styles.sectionHeader}>
      <div><h2>Modelos y versiones</h2><p>Ordenados por menor precio final observado.</p></div>
      <b>{integer.format(vehicles.length)} resultados</b>
    </div>

    {loading ? <div className={styles.loading}>Cargando catálogo desde ClickHouse…</div> : null}
    {!loading && error ? <div className={styles.error}>{error}</div> : null}
    {!loading && !error && vehicles.length === 0 ? <div className={styles.empty}>
      <strong>No hay precios para esta combinación.</strong>
      <p>El crawler automotriz amplía cobertura por concesionario y actualiza el histórico los lunes y viernes.</p>
    </div> : null}

    {!loading && !error && vehicles.length > 0 ? <div className={styles.tableShell}>
      <table className={styles.table}>
        <thead><tr>
          <th>Modelo</th>
          <th>Versión</th>
          <th>Concesionario</th>
          <th>Precio lista</th>
          <th>Bono marca</th>
          <th>Bonos adicionales</th>
          <th>Precio contado</th>
          <th>Bono financiamiento</th>
          <th>Precio final</th>
        </tr></thead>
        <tbody>{vehicles.map((vehicle) => {
          const extraBonus = vehicle.onlineBonus + vehicle.dealerBonus;
          return <tr key={vehicle.id}>
            <td className={styles.modelCell}><strong>{vehicle.model}</strong></td>
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
  </section>;
}
