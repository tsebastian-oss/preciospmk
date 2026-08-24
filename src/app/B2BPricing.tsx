"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./B2BPricing.module.css";

type Numeric = number | string | null;
type Provider = {
  providerGroup: string;
  providerName: string;
  observations: Numeric;
  buyers: Numeric;
  amount: Numeric;
  sharePct: Numeric;
  medianUnitPrice: Numeric;
  minUnitPrice: Numeric;
  maxUnitPrice: Numeric;
  latestDate: string | null;
};
type Service = { serviceType: string; observations: Numeric; amount: Numeric; medianUnitPrice: Numeric };
type Observation = {
  id: number;
  providerGroup: string;
  providerName: string;
  buyerName: string | null;
  serviceType: string | null;
  classificationCode: string | null;
  description: string | null;
  quantity: Numeric;
  unit: string | null;
  unitPriceClp: Numeric;
  totalAmountClp: Numeric;
  priceBasis: string | null;
  processDate: string | null;
  sourceUrl: string | null;
  sourceKind: string | null;
};
type ComparableRow = {
  profileKey: string;
  serviceType: string | null;
  weightBand: string | null;
  distanceBand: string | null;
  providerGroup: string;
  providerName: string;
  observations: Numeric;
  medianShipmentPrice: Numeric;
  medianPricePerKg: Numeric;
  medianPricePerKm: Numeric;
  medianPricePerKgKm: Numeric;
  marketMedianShipmentPrice: Numeric;
  marketMedianPricePerKg: Numeric;
  marketMedianPricePerKm: Numeric;
  providersInProfile: Numeric;
  indexVsMarket: Numeric;
  latestDate: string | null;
  confidence: Numeric;
  originLabel: string | null;
  destinationLabel: string | null;
};
type NormalizedPayload = {
  summary: {
    comparableRows?: Numeric;
    fullRows?: Numeric;
    providers?: Numeric;
    profiles?: Numeric;
    competitiveProfiles?: Numeric;
    latestDate?: string | null;
  };
  profiles: Array<{ profileKey: string; weightBand?: string | null; distanceBand?: string | null }>;
  rows: ComparableRow[];
};
type Payload = {
  category: string;
  days: number;
  summary: {
    observations?: Numeric;
    providers?: Numeric;
    buyers?: Numeric;
    marketAmount?: Numeric;
    medianUnitPrice?: Numeric;
    latestDate?: string | null;
    lastIngestedAt?: string | null;
  };
  providers: Provider[];
  services: Service[];
  recent: Observation[];
  normalized?: NormalizedPayload;
  source: string;
  error?: string;
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
const WEIGHT_BANDS = ["0–1 kg", "1–3 kg", "3–5 kg", "5–10 kg", "10–20 kg", "20+ kg"];
const DISTANCE_BANDS = ["0–50 km", "50–200 km", "200–500 km", "500–1.000 km", "1.000+ km"];
function n(value: Numeric | undefined) { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function date(value?: string | null) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(d); }
function sourceKind(value?: string | null) {
  if (value === "trato_directo") return "Trato directo";
  if (value === "convenio_marco") return "Convenio Marco";
  if (value === "licitacion") return "Licitación";
  return value || "Mercado Público";
}
function indexLabel(value: Numeric) {
  const index = n(value);
  if (!index) return "Sin competencia comparable";
  const gap = index - 100;
  if (Math.abs(gap) < 1) return "En mediana de mercado";
  return `${gap > 0 ? "+" : ""}${gap.toFixed(1)}% vs mediana`;
}

export default function B2BPricing() {
  const [days, setDays] = useState(365);
  const [provider, setProvider] = useState("all");
  const [weightBand, setWeightBand] = useState("all");
  const [distanceBand, setDistanceBand] = useState("all");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/b2b-pricing?category=courier&days=${days}&live=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar Pricing B2B");
      setData(payload);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando Pricing B2B");
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/b2b-pricing/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: 2, maxPages: 6 }),
      });
      const result = await response.json() as { matched?: number; ingested?: number; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible actualizar Mercado Público");
      setNotice(`Fuente actualizada: ${nf.format(Number(result.matched || 0))} observaciones courier detectadas.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando Mercado Público");
    } finally { setRefreshing(false); }
  };

  const providers = data?.providers ?? [];
  const providerOptions = providers.map((item) => item.providerGroup);
  const rows = useMemo(() => (data?.recent ?? []).filter((row) => provider === "all" || row.providerGroup === provider), [data, provider]);
  const maxShare = Math.max(1, ...providers.map((item) => n(item.sharePct)));
  const normalized = data?.normalized ?? { summary: {}, profiles: [], rows: [] };
  const comparableRows = useMemo(() => (normalized.rows ?? []).filter((row) => {
    if (provider !== "all" && row.providerGroup !== provider) return false;
    if (weightBand !== "all" && row.weightBand !== weightBand) return false;
    if (distanceBand !== "all" && row.distanceBand !== distanceBand) return false;
    return true;
  }), [normalized.rows, provider, weightBand, distanceBand]);

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>B2B PRICE INTELLIGENCE</div>
        <h1>Pricing B2B</h1>
        <p>Benchmark de courier normalizado para comparar el mismo tipo de envío entre operadores: precio por envío, por kilo y por kilómetro.</p>
      </div>
      <div className={styles.sourceBadge}><i/> MERCADO PÚBLICO · RATE CARDS</div>
    </div>

    <div className={styles.toolbar}>
      <label>Vertical<select value="courier" disabled><option>Courier & Logistics</option></select></label>
      <label>Período<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={90}>90 días</option><option value={180}>180 días</option><option value={365}>12 meses</option><option value={730}>24 meses</option></select></label>
      <label>Proveedor<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">Todos</option>{providerOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Peso<select value={weightBand} onChange={(event) => setWeightBand(event.target.value)}><option value="all">Todos</option>{WEIGHT_BANDS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Distancia<select value={distanceBand} onChange={(event) => setDistanceBand(event.target.value)}><option value="all">Todas</option>{DISTANCE_BANDS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className={styles.refresh} onClick={refresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar fuentes"}</button>
    </div>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Cargando inteligencia B2B…</div> : null}

    {!loading && data ? <>
      <article className={styles.normalizedCard}>
        <header className={styles.normalizedHeader}>
          <div><span>APPLE-TO-APPLE BENCHMARK</span><h2>Comparación homogénea de tarifas courier</h2><p>Solo entran precios cuya unidad puede normalizarse. Contratos mensuales, montos globales y adjudicaciones nominales quedan fuera.</p></div>
          <div className={styles.logicBadge}>MEDIANA POR PERFIL · ÍNDICE 100 = MERCADO</div>
        </header>
        <div className={styles.normalizedKpis}>
          <div><span>Filas comparables</span><strong>{nf.format(n(normalized.summary.comparableRows))}</strong><small>Precio + peso o distancia explícitos</small></div>
          <div><span>Comparables completos</span><strong>{nf.format(n(normalized.summary.fullRows))}</strong><small>Precio + kg + km</small></div>
          <div><span>Perfiles homogéneos</span><strong>{nf.format(n(normalized.summary.profiles))}</strong><small>Servicio × peso × distancia</small></div>
          <div><span>Perfiles competitivos</span><strong>{nf.format(n(normalized.summary.competitiveProfiles))}</strong><small>2+ operadores comparables</small></div>
        </div>
        <div className={styles.tableWrap}><table className={styles.benchmarkTable}><thead><tr><th>Perfil comparable</th><th>Proveedor</th><th>Ruta</th><th>Precio / envío</th><th>$/kg</th><th>$/km</th><th>Índice vs mercado</th><th>Cobertura</th><th>Fecha</th></tr></thead><tbody>
          {comparableRows.map((row) => <tr key={`${row.profileKey}-${row.providerGroup}`}>
            <td><b>{row.serviceType || "Courier"}</b><div className={styles.subline}>{row.weightBand || "Sin peso"} · {row.distanceBand || "Sin distancia"}</div></td>
            <td><b>{row.providerGroup}</b><div className={styles.subline}>{nf.format(n(row.observations))} observaciones</div></td>
            <td>{row.originLabel || row.destinationLabel ? `${row.originLabel || "?"} → ${row.destinationLabel || "?"}` : "Perfil por banda"}</td>
            <td>{n(row.medianShipmentPrice) > 0 ? money.format(n(row.medianShipmentPrice)) : "—"}</td>
            <td>{n(row.medianPricePerKg) > 0 ? money.format(n(row.medianPricePerKg)) : "—"}</td>
            <td>{n(row.medianPricePerKm) > 0 ? money.format(n(row.medianPricePerKm)) : "—"}</td>
            <td><span className={styles.indexBadge}>{indexLabel(row.indexVsMarket)}</span></td>
            <td><span className={styles.coverage}>{nf.format(n(row.providersInProfile))} proveedores · {decimal.format(n(row.confidence))}% confianza</span></td>
            <td>{date(row.latestDate)}</td>
          </tr>)}
          {!comparableRows.length ? <tr><td colSpan={9} className={styles.empty}><b>Aún no hay suficientes líneas normalizables.</b><br/>La capa está lista para tarifarios por localidad/peso y órdenes con kg o km explícitos. Los contratos agregados que ves abajo no se fuerzan artificialmente a $/kg.</td></tr> : null}
        </tbody></table></div>
        <div className={styles.methodStrip}><b>Cómo se compara:</b> cada fila pertenece a un perfil estándar (servicio + banda de peso + banda de distancia). El índice solo se calcula cuando el mismo perfil tiene al menos 2 operadores: 100 = mediana, 110 = 10% sobre mercado, 90 = 10% bajo mercado.</div>
      </article>

      <div className={styles.kpis}>
        <article><span>Monto observado</span><strong>{compactMoney.format(n(data.summary.marketAmount))}</strong><small>Compras públicas clasificadas como courier</small></article>
        <article><span>Observaciones</span><strong>{nf.format(n(data.summary.observations))}</strong><small>Ítems / adjudicaciones detectadas</small></article>
        <article><span>Proveedores</span><strong>{nf.format(n(data.summary.providers))}</strong><small>Operadores con actividad observada</small></article>
        <article><span>Compradores</span><strong>{nf.format(n(data.summary.buyers))}</strong><small>Organismos públicos distintos</small></article>
        <article><span>Precio unitario mediano</span><strong>{n(data.summary.medianUnitPrice) > 0 ? money.format(n(data.summary.medianUnitPrice)) : "—"}</strong><small>Contexto; no implica tarifa por envío</small></article>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <header><div><span>MARKET CONTEXT</span><h2>Participación por monto observado</h2></div><small>Último dato {date(data.summary.latestDate)}</small></header>
          <div className={styles.providerBars}>{providers.length ? providers.map((item) => <div className={styles.providerRow} key={item.providerGroup}>
            <div className={styles.providerHead}><strong>{item.providerGroup}</strong><span>{n(item.sharePct).toFixed(1)}%</span></div>
            <div className={styles.track}><i style={{ width: `${Math.max(2, n(item.sharePct) / maxShare * 100)}%` }}/></div>
            <div className={styles.providerMeta}><span>{compactMoney.format(n(item.amount))}</span><span>{nf.format(n(item.observations))} obs.</span><span>{nf.format(n(item.buyers))} compradores</span></div>
          </div>) : <div className={styles.empty}>Aún no hay observaciones cargadas. Usa “Actualizar fuentes”.</div>}</div>
        </article>

        <article className={styles.card}>
          <header><div><span>DATA QUALITY</span><h2>Qué entra al benchmark</h2></div></header>
          <div className={styles.services}>{(data.services ?? []).slice(0, 8).map((item) => <div key={item.serviceType}><strong>{item.serviceType}</strong><span>{nf.format(n(item.observations))} obs.</span><b>{compactMoney.format(n(item.amount))}</b></div>)}</div>
          <div className={styles.method}><strong>Regla de comparabilidad</strong><p>Una adjudicación global puede mostrar quién ganó, pero no cuánto cuesta un envío. El benchmark normalizado solo acepta líneas con una base tarifaria identificable; luego las agrupa por peso y distancia.</p></div>
        </article>
      </div>

      <article className={styles.tableCard}>
        <header><div><span>PUBLIC B2B MARKET</span><h2>Contratos y órdenes observadas</h2></div><small>{rows.length} registros visibles</small></header>
        <div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprador</th><th>Servicio</th><th>Descripción</th><th>Precio unit.</th><th>Monto</th><th>Proceso</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}><td>{date(row.processDate)}</td><td><b>{row.providerGroup}</b></td><td>{row.buyerName || "—"}</td><td>{row.serviceType || "—"}</td><td className={styles.description}>{row.description || "—"}</td><td>{n(row.unitPriceClp) > 0 ? money.format(n(row.unitPriceClp)) : "—"}</td><td>{n(row.totalAmountClp) > 0 ? money.format(n(row.totalAmountClp)) : "—"}</td><td>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{sourceKind(row.sourceKind)} ↗</a> : sourceKind(row.sourceKind)}</td></tr>)}
          {!rows.length ? <tr><td colSpan={8} className={styles.empty}>Sin observaciones para los filtros seleccionados.</td></tr> : null}
        </tbody></table></div>
      </article>

      <div className={styles.footnote}>Fuente: Mercado Público / ChileCompra y capas tarifarias normalizadas. El benchmark separa mercado público adjudicado, tarifarios comparables y contratos agregados; no representa contratos privados no publicados. Última ingestión: {date(data.summary.lastIngestedAt)}.</div>
    </> : null}
  </section>;
}
