"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./B2BPricing.module.css";
import matrixStyles from "./B2BPricingMatrix.module.css";

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

type MatrixMetric = "shipment" | "kg" | "km" | "kgkm" | "index";
type MatrixLane = {
  key: string;
  serviceType: string;
  weightBand: string;
  distanceBand: string;
  originLabel: string;
  destinationLabel: string;
  providerRows: Record<string, ComparableRow>;
  reference: ComparableRow;
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
const WEIGHT_BANDS = ["0–0,5 kg", "0,51–1,5 kg", "1,51–3 kg", "3,01–6 kg", "6,01–10 kg", "10,1–15 kg", "15+ kg"];
const DISTANCE_BANDS = ["0–50 km", "50–200 km", "200–500 km", "500–1.000 km", "1.000+ km"];
const METRICS: Array<{ key: MatrixMetric; label: string }> = [
  { key: "shipment", label: "Precio / envío" },
  { key: "kg", label: "$/kg" },
  { key: "km", label: "$/km" },
  { key: "kgkm", label: "$/kg-km" },
  { key: "index", label: "Índice vs mercado" },
];
const PROVIDER_PRIORITY = ["Chilexpress", "Blue Express", "Starken", "CorreosChile"];

function n(value: Numeric | undefined) { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function date(value?: string | null) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(d); }
function sourceKind(value?: string | null) {
  if (value === "trato_directo") return "Trato directo";
  if (value === "convenio_marco") return "Convenio Marco";
  if (value === "licitacion") return "Licitación";
  return value || "Mercado Público";
}
function providerSort(a: string, b: string) {
  const ai = PROVIDER_PRIORITY.indexOf(a);
  const bi = PROVIDER_PRIORITY.indexOf(b);
  if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  return a.localeCompare(b, "es");
}
function metricValue(row: ComparableRow, metric: MatrixMetric) {
  if (metric === "shipment") return n(row.medianShipmentPrice);
  if (metric === "kg") return n(row.medianPricePerKg);
  if (metric === "km") return n(row.medianPricePerKm);
  if (metric === "kgkm") return n(row.medianPricePerKgKm);
  return n(row.indexVsMarket);
}
function marketMetricValue(row: ComparableRow, metric: MatrixMetric) {
  if (metric === "shipment") return n(row.marketMedianShipmentPrice);
  if (metric === "kg") return n(row.marketMedianPricePerKg);
  if (metric === "km") return n(row.marketMedianPricePerKm);
  if (metric === "kgkm") {
    const kg = n(row.marketMedianPricePerKg);
    const km = n(row.medianPricePerKm);
    const providerKg = n(row.medianPricePerKg);
    return providerKg > 0 && km > 0 ? kg * (km / providerKg) : 0;
  }
  return 100;
}
function formatMetric(value: number, metric: MatrixMetric) {
  if (!value) return "—";
  if (metric === "index") return decimal.format(value);
  return money.format(value);
}
function gapPct(row: ComparableRow, metric: MatrixMetric) {
  const value = metricValue(row, metric);
  const market = marketMetricValue(row, metric);
  if (!value || !market) return null;
  return metric === "index" ? value - 100 : (value / market - 1) * 100;
}
function gapLabel(gap: number | null) {
  if (gap === null || !Number.isFinite(gap)) return "sin base comparable";
  if (Math.abs(gap) < 0.1) return "en mercado";
  return `${gap > 0 ? "+" : ""}${gap.toFixed(1)}% vs mercado`;
}

export default function B2BPricing() {
  const [days, setDays] = useState(365);
  const [provider, setProvider] = useState("all");
  const [weightBand, setWeightBand] = useState("all");
  const [distanceBand, setDistanceBand] = useState("all");
  const [matrixMetric, setMatrixMetric] = useState<MatrixMetric>("shipment");
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
      const result = await response.json() as { matched?: number; ingested?: number; rateCards?: { ingested?: number }; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible actualizar las fuentes");
      setNotice(`Fuentes actualizadas: ${nf.format(Number(result.matched || 0))} observaciones públicas · ${nf.format(Number(result.rateCards?.ingested || 0))} tarifas comerciales.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando fuentes");
    } finally { setRefreshing(false); }
  };

  const providers = data?.providers ?? [];
  const normalized = data?.normalized ?? { summary: {}, profiles: [], rows: [] };
  const providerOptions = useMemo(() => Array.from(new Set([
    ...providers.map((item) => item.providerGroup),
    ...(normalized.rows ?? []).map((item) => item.providerGroup),
  ])).sort(providerSort), [providers, normalized.rows]);
  const rows = useMemo(() => (data?.recent ?? []).filter((row) => provider === "all" || row.providerGroup === provider), [data, provider]);
  const maxShare = Math.max(1, ...providers.map((item) => n(item.sharePct)));
  const comparableRows = useMemo(() => (normalized.rows ?? []).filter((row) => {
    if (provider !== "all" && row.providerGroup !== provider) return false;
    if (weightBand !== "all" && row.weightBand !== weightBand) return false;
    if (distanceBand !== "all" && row.distanceBand !== distanceBand) return false;
    return true;
  }), [normalized.rows, provider, weightBand, distanceBand]);

  const matrixProviders = useMemo(() => Array.from(new Set(comparableRows.map((row) => row.providerGroup))).sort(providerSort), [comparableRows]);
  const matrixRows = useMemo(() => {
    const lanes = new Map<string, MatrixLane>();
    for (const row of comparableRows) {
      const existing = lanes.get(row.profileKey);
      if (existing) {
        existing.providerRows[row.providerGroup] = row;
        continue;
      }
      lanes.set(row.profileKey, {
        key: row.profileKey,
        serviceType: row.serviceType || "Courier",
        weightBand: row.weightBand || "—",
        distanceBand: row.distanceBand || "—",
        originLabel: row.originLabel || "?",
        destinationLabel: row.destinationLabel || "?",
        providerRows: { [row.providerGroup]: row },
        reference: row,
      });
    }
    return Array.from(lanes.values()).sort((a, b) => {
      const destination = a.destinationLabel.localeCompare(b.destinationLabel, "es");
      if (destination !== 0) return destination;
      return a.weightBand.localeCompare(b.weightBand, "es");
    });
  }, [comparableRows]);

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>B2B PRICE INTELLIGENCE</div>
        <h1>Pricing B2B</h1>
        <p>Matriz competitiva de courier para comparar el mismo envío, la misma ruta y la misma banda de peso entre operadores.</p>
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
          <div><span>COURIER PRICE MATRIX</span><h2>Matriz competitiva por ruta y peso</h2><p>Las filas son perfiles homogéneos. Los couriers quedan en columnas para comparar de izquierda a derecha, sin mezclar contratos globales con tarifas unitarias.</p></div>
          <div className={styles.logicBadge}>MISMO ENVÍO · MISMA RUTA · MISMO PESO</div>
        </header>

        <div className={styles.normalizedKpis}>
          <div><span>Tarifas comparables</span><strong>{nf.format(n(normalized.summary.comparableRows))}</strong><small>Precios normalizables</small></div>
          <div><span>Rutas / perfiles</span><strong>{nf.format(n(normalized.summary.profiles))}</strong><small>Perfiles homogéneos</small></div>
          <div><span>Operadores</span><strong>{nf.format(n(normalized.summary.providers))}</strong><small>Con tarifas comparables</small></div>
          <div><span>Perfiles competitivos</span><strong>{nf.format(n(normalized.summary.competitiveProfiles))}</strong><small>2+ operadores en la misma fila</small></div>
        </div>

        <div className={matrixStyles.matrixControls}>
          <div>
            <span className={matrixStyles.controlLabel}>Métrica de comparación</span>
            <div className={matrixStyles.metricTabs}>
              {METRICS.map((metric) => <button key={metric.key} type="button" className={matrixMetric === metric.key ? matrixStyles.activeMetric : ""} onClick={() => setMatrixMetric(metric.key)}>{metric.label}</button>)}
            </div>
          </div>
          <div className={matrixStyles.matrixLegend}><span><i className={matrixStyles.belowDot}/> Bajo mercado</span><span><i className={matrixStyles.neutralDot}/> En mercado</span><span><i className={matrixStyles.aboveDot}/> Sobre mercado</span></div>
        </div>

        <div className={matrixStyles.matrixScroller}>
          <table className={matrixStyles.matrixTable}>
            <thead>
              <tr>
                <th className={matrixStyles.routeHeader}>Ruta / perfil</th>
                {matrixProviders.map((name) => <th key={name} className={matrixStyles.providerHeader}><b>{name}</b><span>{matrixMetric === "index" ? "Índice 100 = mercado" : METRICS.find((item) => item.key === matrixMetric)?.label}</span></th>)}
                <th className={matrixStyles.marketHeader}><b>Mediana mercado</b><span>Perfil comparable</span></th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((lane) => {
                const availableValues = matrixProviders.map((name) => lane.providerRows[name] ? metricValue(lane.providerRows[name], matrixMetric) : 0).filter((value) => value > 0);
                const minValue = availableValues.length ? Math.min(...availableValues) : 0;
                const marketValue = marketMetricValue(lane.reference, matrixMetric);
                return <tr key={lane.key}>
                  <td className={matrixStyles.routeCell}>
                    <b>{lane.originLabel} → {lane.destinationLabel}</b>
                    <span>{lane.weightBand} · {lane.distanceBand}</span>
                    <small>{lane.serviceType}</small>
                  </td>
                  {matrixProviders.map((name) => {
                    const row = lane.providerRows[name];
                    if (!row) return <td key={name} className={matrixStyles.emptyMatrixCell}>—<span>sin tarifa comparable</span></td>;
                    const value = metricValue(row, matrixMetric);
                    const gap = gapPct(row, matrixMetric);
                    const tone = gap === null || Math.abs(gap) <= 2 ? matrixStyles.neutralCell : gap < 0 ? matrixStyles.belowCell : matrixStyles.aboveCell;
                    const isLowest = matrixMetric !== "index" && value > 0 && value === minValue && availableValues.length > 1;
                    return <td key={name} className={`${matrixStyles.metricCell} ${tone}`}>
                      <strong>{formatMetric(value, matrixMetric)}</strong>
                      <span>{gapLabel(gap)}</span>
                      <small>{isLowest ? "MENOR TARIFA" : `${decimal.format(n(row.confidence))}% confianza`}</small>
                    </td>;
                  })}
                  <td className={matrixStyles.marketCell}><strong>{formatMetric(marketValue, matrixMetric)}</strong><span>índice 100</span></td>
                </tr>;
              })}
              {!matrixRows.length ? <tr><td colSpan={Math.max(2, matrixProviders.length + 2)} className={styles.empty}><b>No hay perfiles para estos filtros.</b><br/>Prueba dejando proveedor, peso o distancia en “Todos”.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className={styles.methodStrip}><b>Lectura:</b> cada fila es una comparación manzana-con-manzana. El color indica posición contra la mediana del mismo perfil. “Menor tarifa” identifica el precio más bajo observado en esa fila; no implica por sí solo mejor nivel de servicio.</div>
      </article>

      <div className={styles.kpis}>
        <article><span>Monto observado</span><strong>{compactMoney.format(n(data.summary.marketAmount))}</strong><small>Compras públicas clasificadas como courier</small></article>
        <article><span>Observaciones</span><strong>{nf.format(n(data.summary.observations))}</strong><small>Ítems / adjudicaciones detectadas</small></article>
        <article><span>Proveedores</span><strong>{nf.format(n(data.summary.providers))}</strong><small>Operadores en Mercado Público</small></article>
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
          <div className={styles.method}><strong>Regla de comparabilidad</strong><p>Una adjudicación global puede mostrar quién ganó, pero no cuánto cuesta un envío. La matriz solo usa tarifas con una base comparable de ruta, peso y precio.</p></div>
        </article>
      </div>

      <article className={styles.tableCard}>
        <header><div><span>PUBLIC B2B MARKET</span><h2>Detalle de contratos y órdenes</h2></div><small>{rows.length} registros visibles</small></header>
        <div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprador</th><th>Servicio</th><th>Descripción</th><th>Precio unit.</th><th>Monto</th><th>Proceso</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}><td>{date(row.processDate)}</td><td><b>{row.providerGroup}</b></td><td>{row.buyerName || "—"}</td><td>{row.serviceType || "—"}</td><td className={styles.description}>{row.description || "—"}</td><td>{n(row.unitPriceClp) > 0 ? money.format(n(row.unitPriceClp)) : "—"}</td><td>{n(row.totalAmountClp) > 0 ? money.format(n(row.totalAmountClp)) : "—"}</td><td>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{sourceKind(row.sourceKind)} ↗</a> : sourceKind(row.sourceKind)}</td></tr>)}
          {!rows.length ? <tr><td colSpan={8} className={styles.empty}>Sin observaciones para los filtros seleccionados.</td></tr> : null}
        </tbody></table></div>
      </article>

      <div className={styles.footnote}>Fuente: Mercado Público / ChileCompra y tarifarios públicos normalizados. La matriz separa tarifas comparables de contratos agregados y no representa contratos privados no publicados. Última ingestión: {date(data.summary.lastIngestedAt)}.</div>
    </> : null}
  </section>;
}
