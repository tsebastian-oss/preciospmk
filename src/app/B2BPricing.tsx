"use client";

// COURIER_SEGMENTED_ACCORDION_V1
import { useCallback, useEffect, useMemo, useState } from "react";
import B2BProfitabilitySimulator from "./B2BProfitabilitySimulator";
import styles from "./CourierPricingAccordion.module.css";

type Numeric = number | string | null;

type Observation = {
  id: number;
  providerGroup: string;
  providerName: string;
  buyerName: string | null;
  serviceType: string | null;
  description: string | null;
  unitPriceClp: Numeric;
  totalAmountClp: Numeric;
  processDate: string | null;
  sourceUrl: string | null;
  sourceKind: string | null;
};

type ComparableRow = {
  profileKey: string;
  serviceType: string | null;
  weightBand: string | null;
  distanceBand: string | null;
  referenceWeightKg?: Numeric;
  referenceDistanceKm?: Numeric;
  providerGroup: string;
  providerName: string;
  sourceChannel?: string | null;
  sourceKinds?: string[];
  observations: Numeric;
  medianShipmentPrice: Numeric;
  medianPricePerKg: Numeric;
  medianPricePerKm: Numeric;
  medianPricePerKgKm: Numeric;
  marketMedianShipmentPrice: Numeric;
  marketMedianPricePerKg: Numeric;
  marketMedianPricePerKm: Numeric;
  marketMedianPricePerKgKm?: Numeric;
  providersInProfile: Numeric;
  indexVsMarket: Numeric;
  latestDate: string | null;
  confidence: Numeric;
  originLabel: string | null;
  destinationLabel: string | null;
};

type NormalizedPayload = {
  layer?: string;
  summary: {
    comparableRows?: Numeric;
    providers?: Numeric;
    profiles?: Numeric;
    competitiveProfiles?: Numeric;
    latestDate?: string | null;
    b2cRows?: Numeric;
    b2bRows?: Numeric;
    pymeRows?: Numeric;
    observedB2bRows?: Numeric;
  };
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
    latestDate?: string | null;
    lastIngestedAt?: string | null;
  };
  recent: Observation[];
  normalized?: NormalizedPayload;
  annexes?: {
    detected?: Numeric;
    candidateRates?: Numeric;
    latestDate?: string | null;
  };
  source: string;
  error?: string;
};

type SegmentStats = {
  rows: number;
  providers: number;
  min: number;
  max: number;
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

function n(value: Numeric | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(parsed);
}

function sourceKind(value?: string | null) {
  if (value === "trato_directo") return "Trato directo";
  if (value === "convenio_marco") return "Convenio Marco";
  if (value === "licitacion") return "Licitación";
  return value || "Mercado Público";
}

function displayProvider(value: string) {
  if (value === "Blue Express B2C / Público") return "Blue Express · Tarifa pública";
  if (value === "Blue Express Ecommerce 1–500") return "Blue Express · Pyme / Ecommerce";
  if (value === "Chilexpress") return "Chilexpress · Emprendedores";
  if (value === "Starken Tarifa Simple") return "Starken · Tarifa Simple";
  if (value === "Starken Partner Colina") return "Starken · Partner Colina";
  if (value === "Starken Partner Montaña") return "Starken · Partner Montaña";
  if (value === "Starken Partner Cordillera") return "Starken · Partner Cordillera";
  return value;
}

function segmentStats(rows: ComparableRow[]): SegmentStats {
  const values = rows.map((row) => n(row.medianShipmentPrice)).filter((value) => value > 0);
  return {
    rows: rows.length,
    providers: new Set(rows.map((row) => row.providerGroup)).size,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

function indexClass(value: number) {
  if (!value || Math.abs(value - 100) <= 2) return styles.indexNeutral;
  return value < 100 ? styles.indexLow : styles.indexHigh;
}

function confidenceLabel(value: Numeric) {
  const score = n(value);
  return score ? `${decimal.format(score)}% confianza` : "sin score";
}

export default function B2BPricing() {
  const [days, setDays] = useState(365);
  const [provider, setProvider] = useState("all");
  const [destination, setDestination] = useState("all");
  const [weightBand, setWeightBand] = useState("all");
  const [b2c, setB2C] = useState<Payload | null>(null);
  const [b2b, setB2B] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stamp = Date.now();
      const [b2cResponse, b2bResponse] = await Promise.all([
        fetch(`/api/b2b-pricing?category=courier&days=${days}&layer=b2c&live=${stamp}`, { cache: "no-store" }),
        fetch(`/api/b2b-pricing?category=courier&days=${days}&layer=b2b&live=${stamp}`, { cache: "no-store" }),
      ]);
      const [b2cPayload, b2bPayload] = await Promise.all([
        b2cResponse.json() as Promise<Payload>,
        b2bResponse.json() as Promise<Payload>,
      ]);
      if (!b2cResponse.ok) throw new Error(b2cPayload.error || "No fue posible cargar tarifas B2C");
      if (!b2bResponse.ok) throw new Error(b2bPayload.error || "No fue posible cargar tarifas B2B");
      setB2C(b2cPayload);
      setB2B(b2bPayload);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando Courier & Logistics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const requestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: 2, maxPages: 4 }),
      } as const;
      const [marketResponse, publicResponse, annexResponse] = await Promise.all([
        fetch("/api/b2b-pricing/refresh", requestInit),
        fetch("/api/b2b-pricing/public-rates/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
        fetch("/api/b2b-pricing/market-public-rates/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      ]);
      const market = await marketResponse.json() as { matched?: number; error?: string };
      const publicRates = await publicResponse.json() as { ingested?: number; rows?: number; error?: string };
      const annexes = await annexResponse.json() as { acceptedComparableRates?: number; candidateRates?: number; error?: string };
      if (!marketResponse.ok) throw new Error(market.error || "No fue posible actualizar Mercado Público");
      if (!publicResponse.ok) throw new Error(publicRates.error || "No fue posible actualizar tarifas comerciales");
      if (!annexResponse.ok) throw new Error(annexes.error || "No fue posible revisar anexos B2B");
      setNotice(
        `Actualizado: ${nf.format(Number(publicRates.rows || publicRates.ingested || 0))} tarifas comerciales · ` +
        `${nf.format(Number(annexes.acceptedComparableRates || 0))} tarifas B2B verificadas · ` +
        `${nf.format(Number(market.matched || 0))} observaciones de mercado.`
      );
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando fuentes");
    } finally {
      setRefreshing(false);
    }
  };

  const b2cRows = b2c?.normalized?.rows ?? [];
  const allB2BRows = b2b?.normalized?.rows ?? [];
  const pymeRows = allB2BRows.filter((row) => row.sourceChannel === "Pyme / Emprendedores");
  const observedRows = allB2BRows.filter((row) => row.sourceChannel === "B2B observado");

  const allRows = useMemo(
    () => [...b2cRows, ...pymeRows, ...observedRows],
    [b2cRows, pymeRows, observedRows],
  );

  const providerOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.providerGroup))).sort((a, b) => displayProvider(a).localeCompare(displayProvider(b), "es")),
    [allRows],
  );

  const destinationOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.destinationLabel).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "es")),
    [allRows],
  );

  const weightOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.weightBand).filter((value): value is string => Boolean(value)))),
    [allRows],
  );

  const filterRows = useCallback((rows: ComparableRow[]) => rows.filter((row) => {
    if (provider !== "all" && row.providerGroup !== provider) return false;
    if (destination !== "all" && row.destinationLabel !== destination) return false;
    if (weightBand !== "all" && row.weightBand !== weightBand) return false;
    return true;
  }), [provider, destination, weightBand]);

  const visibleB2C = filterRows(b2cRows);
  const visiblePyme = filterRows(pymeRows);
  const visibleObserved = filterRows(observedRows);

  const b2cStats = segmentStats(visibleB2C);
  const pymeStats = segmentStats(visiblePyme);
  const observedStats = segmentStats(visibleObserved);
  const contextData = b2b || b2c;

  const groupedProviders = (rows: ComparableRow[]) => {
    const groups = new Map<string, ComparableRow[]>();
    for (const row of rows) {
      const current = groups.get(row.providerGroup) || [];
      current.push(row);
      groups.set(row.providerGroup, current);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => displayProvider(a).localeCompare(displayProvider(b), "es"))
      .map(([name, providerRows]) => ({
        name,
        rows: providerRows.sort((a, b) => {
          const destinationOrder = String(a.destinationLabel || "").localeCompare(String(b.destinationLabel || ""), "es");
          if (destinationOrder !== 0) return destinationOrder;
          const weightOrder = n(a.referenceWeightKg) - n(b.referenceWeightKg);
          if (weightOrder !== 0) return weightOrder;
          return String(a.serviceType || "").localeCompare(String(b.serviceType || ""), "es");
        }),
      }));
  };

  const renderProviderList = (rows: ComparableRow[], emptyCopy: string) => {
    const groups = groupedProviders(rows);
    if (!groups.length) return <div className={styles.empty}>{emptyCopy}</div>;

    return <div className={styles.providerList}>
      {groups.map((group) => {
        const stats = segmentStats(group.rows);
        const latest = group.rows.map((row) => row.latestDate).filter(Boolean).sort().at(-1) || null;
        return <details className={styles.provider} key={group.name}>
          <summary>
            <div className={styles.providerName}>
              <strong>{displayProvider(group.name)}</strong>
              <small>{group.rows.length} referencias comparables · actualizado {date(latest)}</small>
            </div>
            <div className={styles.providerMetric}>
              <b>{stats.min ? money.format(stats.min) : "—"} – {stats.max ? money.format(stats.max) : "—"}</b>
              <span>rango observado</span>
            </div>
            <div className={styles.providerMetric}>
              <b>{new Set(group.rows.map((row) => row.destinationLabel)).size}</b>
              <span>destinos</span>
            </div>
            <span className={styles.providerChevron}>⌄</span>
          </summary>
          <div className={styles.providerBody}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ruta</th>
                    <th>Peso</th>
                    <th>Servicio</th>
                    <th>Tarifa</th>
                    <th>$/kg</th>
                    <th>Mediana mercado</th>
                    <th>Índice</th>
                    <th>Calidad</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => {
                    const indexValue = n(row.indexVsMarket);
                    return <tr key={`${row.profileKey}-${row.sourceChannel || ""}-${index}`}>
                      <td className={styles.routeCell}>
                        <b>{row.originLabel || "—"} → {row.destinationLabel || "—"}</b>
                        <small>{row.distanceBand || "sin distancia normalizada"}</small>
                      </td>
                      <td>{row.weightBand || "—"}{n(row.referenceWeightKg) ? <small> · {decimal.format(n(row.referenceWeightKg))} kg</small> : null}</td>
                      <td>{row.serviceType || "Courier"}</td>
                      <td className={styles.priceCell}>
                        <strong>{n(row.medianShipmentPrice) ? money.format(n(row.medianShipmentPrice)) : "—"}</strong>
                        <small>{nf.format(n(row.observations))} obs.</small>
                      </td>
                      <td>{n(row.medianPricePerKg) ? money.format(n(row.medianPricePerKg)) : "—"}</td>
                      <td>{n(row.marketMedianShipmentPrice) ? money.format(n(row.marketMedianShipmentPrice)) : "—"}</td>
                      <td>
                        {indexValue
                          ? <span className={`${styles.index} ${indexClass(indexValue)}`}>{decimal.format(indexValue)}</span>
                          : <span className={styles.index}>—</span>}
                      </td>
                      <td>{confidenceLabel(row.confidence)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>;
      })}
    </div>;
  };

  const visibleContracts = (contextData?.recent ?? []).filter((row) => provider === "all" || row.providerGroup === provider);

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>COURIER & LOGISTICS INTELLIGENCE</div>
        <h1>Pricing Courier</h1>
        <p>Tarifas separadas por canal comercial. B2C muestra precio público; B2B separa Pyme/Emprendedores de tarifas observadas en compras públicas.</p>
      </div>
      <div className={styles.sourceBadge}><i/> FUENTES OFICIALES · MERCADO PÚBLICO</div>
    </div>

    <div className={styles.toolbar}>
      <label>Período
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={90}>90 días</option>
          <option value={180}>180 días</option>
          <option value={365}>12 meses</option>
          <option value={730}>24 meses</option>
        </select>
      </label>
      <label>Operador
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="all">Todos</option>
          {providerOptions.map((name) => <option value={name} key={name}>{displayProvider(name)}</option>)}
        </select>
      </label>
      <label>Destino
        <select value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="all">Todos</option>
          {destinationOptions.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <label>Peso
        <select value={weightBand} onChange={(event) => setWeightBand(event.target.value)}>
          <option value="all">Todos</option>
          {weightOptions.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" className={styles.refresh} onClick={refresh} disabled={refreshing}>
        {refreshing ? "Actualizando…" : "Actualizar fuentes"}
      </button>
    </div>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Cargando tarifas por canal…</div> : null}

    {!loading && b2c && b2b ? <>
      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>B2C · Tarifa pública</span>
          <strong>{nf.format(b2cStats.rows)}</strong>
          <small>{nf.format(b2cStats.providers)} operador(es) · {b2cStats.min ? `${money.format(b2cStats.min)} – ${money.format(b2cStats.max)}` : "sin tarifas para los filtros"}</small>
        </article>
        <article className={styles.summaryCard}>
          <span>B2B · Pyme / Emprendedores</span>
          <strong>{nf.format(pymeStats.rows)}</strong>
          <small>{nf.format(pymeStats.providers)} operador(es) · {pymeStats.min ? `${money.format(pymeStats.min)} – ${money.format(pymeStats.max)}` : "sin tarifas para los filtros"}</small>
        </article>
        <article className={styles.summaryCard}>
          <span>B2B · Mercado Público</span>
          <strong>{nf.format(observedStats.rows)}</strong>
          <small>{nf.format(observedStats.providers)} operador(es) · tarifas unitarias verificadas, no montos globales</small>
        </article>
      </div>

      <details className={styles.segment} open>
        <summary>
          <div className={styles.segmentTitle}>
            <span className={`${styles.segmentIcon} ${styles.b2cIcon}`}>B2C</span>
            <div>
              <b>Tarifa pública / consumidor</b>
              <span>Precio abierto, autogestionado o publicado al mercado. No se mezcla con planes Pyme ni contratos negociados.</span>
            </div>
          </div>
          <div className={styles.segmentStats}>
            <div><strong>{nf.format(b2cStats.rows)}</strong><span>tarifas</span></div>
            <div><strong>{nf.format(b2cStats.providers)}</strong><span>operadores</span></div>
          </div>
          <span className={styles.chevron}>⌄</span>
        </summary>
        <div className={styles.segmentBody}>
          {renderProviderList(visibleB2C, "No hay tarifas B2C públicas para estos filtros.")}
          <div className={styles.method}><b>Qué entra aquí:</b> tarifas públicas abiertas al consumidor o al canal autogestionado. Blue Express se muestra como “B2C / Público” porque su plataforma de envío sin mínimo aplica también a persona natural.</div>
        </div>
      </details>

      <details className={styles.segment} open>
        <summary>
          <div className={styles.segmentTitle}>
            <span className={`${styles.segmentIcon} ${styles.b2bIcon}`}>B2B</span>
            <div>
              <b>Pyme / Emprendedores</b>
              <span>Planes comerciales para negocios: Chilexpress Emprendedores, Blue Ecommerce y Starken Tarifa Simple / Partner.</span>
            </div>
          </div>
          <div className={styles.segmentStats}>
            <div><strong>{nf.format(pymeStats.rows)}</strong><span>tarifas</span></div>
            <div><strong>{nf.format(pymeStats.providers)}</strong><span>operadores</span></div>
          </div>
          <span className={styles.chevron}>⌄</span>
        </summary>
        <div className={styles.segmentBody}>
          {renderProviderList(visiblePyme, "No hay tarifas Pyme / Emprendedores para estos filtros.")}
          <div className={styles.method}><b>Qué entra aquí:</b> tarifas publicadas para empresas, ecommerce, Pymes o emprendedores. Los descuentos derivados —por ejemplo Somos Partner— se mantienen separados del precio base.</div>
        </div>
      </details>

      <details className={styles.segment}>
        <summary>
          <div className={styles.segmentTitle}>
            <span className={`${styles.segmentIcon} ${styles.marketIcon}`}>MP</span>
            <div>
              <b>B2B observado · Mercado Público</b>
              <span>Tarifas unitarias extraídas de ofertas, anexos u órdenes públicas; nunca presupuestos globales convertidos artificialmente.</span>
            </div>
          </div>
          <div className={styles.segmentStats}>
            <div><strong>{nf.format(observedStats.rows)}</strong><span>tarifas</span></div>
            <div><strong>{nf.format(observedStats.providers)}</strong><span>operadores</span></div>
          </div>
          <span className={styles.chevron}>⌄</span>
        </summary>
        <div className={styles.segmentBody}>
          {renderProviderList(visibleObserved, "Todavía no hay tarifas unitarias B2B verificadas para estos filtros.")}
          <div className={styles.method}><b>Criterio:</b> solo se acepta una tarifa cuando la evidencia permite identificar un precio unitario comparable. Monto total de contrato, presupuesto o garantía no se transforma en precio por envío.</div>
        </div>
      </details>

      <details className={styles.context}>
        <summary>Contexto de Mercado Público y contratos ▾</summary>
        <div className={styles.contextBody}>
          <div className={styles.contextKpis}>
            <div><span>Monto observado</span><strong>{compactMoney.format(n(contextData?.summary.marketAmount))}</strong></div>
            <div><span>Observaciones</span><strong>{nf.format(n(contextData?.summary.observations))}</strong></div>
            <div><span>Proveedores</span><strong>{nf.format(n(contextData?.summary.providers))}</strong></div>
            <div><span>Compradores</span><strong>{nf.format(n(contextData?.summary.buyers))}</strong></div>
          </div>
          <div className={styles.contractWrap}>
            <table className={styles.contractTable}>
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprador</th><th>Servicio</th><th>Descripción</th><th>Precio unit.</th><th>Monto</th><th>Proceso</th></tr></thead>
              <tbody>
                {visibleContracts.map((row) => <tr key={row.id}>
                  <td>{date(row.processDate)}</td>
                  <td><b>{row.providerGroup}</b></td>
                  <td>{row.buyerName || "—"}</td>
                  <td>{row.serviceType || "—"}</td>
                  <td>{row.description || "—"}</td>
                  <td>{n(row.unitPriceClp) ? money.format(n(row.unitPriceClp)) : "—"}</td>
                  <td>{n(row.totalAmountClp) ? money.format(n(row.totalAmountClp)) : "—"}</td>
                  <td>{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{sourceKind(row.sourceKind)} ↗</a> : sourceKind(row.sourceKind)}</td>
                </tr>)}
                {!visibleContracts.length ? <tr><td colSpan={8} className={styles.empty}>Sin contratos para los filtros seleccionados.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details className={styles.profitability}>
        <summary>Simulador de rentabilidad ▾</summary>
        <div className={styles.profitabilityBody}><B2BProfitabilitySimulator/></div>
      </details>

      <div className={styles.footnote}>
        Clasificación comercial: B2C = tarifa pública/consumidor; B2B = Pyme/Emprendedores + B2B observado en Mercado Público. Última ingestión: {date(contextData?.summary.lastIngestedAt)}.
      </div>
    </> : null}
  </section>;
}
