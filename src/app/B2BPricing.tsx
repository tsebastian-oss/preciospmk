"use client";

// COURIER_SEGMENTED_ACCORDION_V1
// COURIER_COMPETITIVE_TABLE_V1
import { useCallback, useEffect, useMemo, useState } from "react";
import B2BProfitabilitySimulator from "./B2BProfitabilitySimulator";
import B2CRegionalPricing from "./B2CRegionalPricing";
import styles from "./CourierCompetitiveTable.module.css";

type Layer = "b2c" | "b2b";
type B2BChannel = "Pyme / Emprendedores" | "B2B observado";
type Numeric = number | string | null;

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
  providersInProfile: Numeric;
  indexVsMarket: Numeric;
  latestDate: string | null;
  confidence: Numeric;
  originLabel: string | null;
  destinationLabel: string | null;
};

type Payload = {
  normalized?: {
    layer?: string;
    summary?: Record<string, unknown>;
    profiles?: Array<Record<string, unknown>>;
    rows?: ComparableRow[];
  };
  summary?: Record<string, unknown>;
  source?: string;
  error?: string;
};

type CompetitiveRow = ComparableRow & {
  company: string;
  price: number;
  pricePerKg: number;
  gapToLeader: number;
  premiumToLeader: number;
  indexToMedian: number;
  premiumToMedian: number;
  premiumToChilexpress: number | null;
  rank: number;
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function n(value: Numeric | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function date(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function companyName(providerGroup: string) {
  if (providerGroup.startsWith("Blue Express")) return "Blue Express";
  if (providerGroup.startsWith("Starken")) return "Starken";
  if (providerGroup === "Chilexpress") return "Chilexpress";
  if (providerGroup.startsWith("CorreosChile")) return "CorreosChile";
  return providerGroup;
}

function planLabel(providerGroup: string) {
  if (providerGroup === "Blue Express B2C / Público") return "Tarifa pública";
  if (providerGroup === "Blue Express Ecommerce 1–500") return "Ecommerce 1–500";
  if (providerGroup === "Chilexpress") return "Emprendedores";
  if (providerGroup === "Starken Tarifa Simple") return "Tarifa Simple";
  if (providerGroup.startsWith("Starken Partner ")) return providerGroup.replace("Starken ", "");
  if (providerGroup === "CorreosChile B2C / Público") return "Tarifa pública";
  if (providerGroup.startsWith("CorreosChile Aliados ")) return providerGroup.replace("CorreosChile ", "");
  return providerGroup;
}

function preferredPlan(providerGroup: string) {
  return [
    "Blue Express Ecommerce 1–500",
    "Chilexpress",
    "Starken Tarifa Simple",
    "CorreosChile Aliados Bronce 10%",
  ].includes(providerGroup);
}

function premiumClass(value: number | null) {
  if (value === null || Math.abs(value) < 0.05) return styles.neutral;
  return value > 0 ? styles.bad : styles.good;
}

function premiumCopy(value: number | null) {
  if (value === null) return "—";
  if (Math.abs(value) < 0.05) return "0,0%";
  return `${value > 0 ? "+" : ""}${pct.format(value)}%`;
}

function profileLabel(row: ComparableRow) {
  const weight = n(row.referenceWeightKg);
  const weightText = weight > 0 ? `${pct.format(weight)} kg` : (row.weightBand || "sin peso");
  return `${row.originLabel || "—"} → ${row.destinationLabel || "—"} · ${weightText} · ${row.serviceType || "Courier"}`;
}

export default function B2BPricing() {
  const [layer, setLayer] = useState<Layer>("b2b");
  const [channel, setChannel] = useState<B2BChannel>("Pyme / Emprendedores");
  const [days, setDays] = useState(365);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (layer === "b2c") {
      setLoading(false);
      setPayload(null);
      setNotice("");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/b2b-pricing?category=courier&days=${days}&layer=${layer}&live=${Date.now()}`,
        { cache: "no-store" },
      );
      const result = await response.json() as Payload;
      if (!response.ok) throw new Error(result.error || "No fue posible cargar Courier & Logistics");
      setPayload(result);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando Courier & Logistics");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [days, layer]);

  useEffect(() => { void load(); }, [load]);

  const allRows = payload?.normalized?.rows ?? [];

  const channelRows = useMemo(() => {
    if (layer === "b2c") return allRows.filter((row) => row.sourceChannel === "B2C público");
    return allRows.filter((row) => row.sourceChannel === channel);
  }, [allRows, layer, channel]);

  const visibleBaseRows = useMemo(() => {
    if (layer !== "b2b" || channel !== "Pyme / Emprendedores" || showAllPlans) return channelRows;
    return channelRows.filter((row) => preferredPlan(row.providerGroup));
  }, [channelRows, layer, channel, showAllPlans]);

  const profiles = useMemo(() => {
    const map = new Map<string, { sample: ComparableRow; companies: Set<string>; rows: number }>();
    for (const row of visibleBaseRows) {
      const current = map.get(row.profileKey);
      if (current) {
        current.rows += 1;
        current.companies.add(companyName(row.providerGroup));
      } else {
        map.set(row.profileKey, { sample: row, companies: new Set([companyName(row.providerGroup)]), rows: 1 });
      }
    }
    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      label: profileLabel(value.sample),
      companies: value.companies.size,
      rows: value.rows,
    })).sort((a, b) => {
      if (a.companies !== b.companies) return b.companies - a.companies;
      if (a.rows !== b.rows) return b.rows - a.rows;
      return a.label.localeCompare(b.label, "es");
    });
  }, [visibleBaseRows]);

  useEffect(() => {
    if (!profiles.length) {
      setSelectedProfile("");
      return;
    }
    if (!profiles.some((profile) => profile.key === selectedProfile)) setSelectedProfile(profiles[0].key);
  }, [profiles, selectedProfile]);

  const selectedRows = useMemo(
    () => visibleBaseRows.filter((row) => row.profileKey === selectedProfile && n(row.medianShipmentPrice) > 0),
    [visibleBaseRows, selectedProfile],
  );

  const competitiveRows = useMemo<CompetitiveRow[]>(() => {
    const prices = selectedRows.map((row) => n(row.medianShipmentPrice)).filter((value) => value > 0);
    if (!prices.length) return [];
    const leader = Math.min(...prices);
    const marketMedian = median(prices);
    const chilexpress = selectedRows.find((row) => companyName(row.providerGroup) === "Chilexpress");
    const chilePrice = chilexpress ? n(chilexpress.medianShipmentPrice) : 0;

    return selectedRows.map((row) => {
      const price = n(row.medianShipmentPrice);
      return {
        ...row,
        company: companyName(row.providerGroup),
        price,
        pricePerKg: n(row.medianPricePerKg),
        gapToLeader: price - leader,
        premiumToLeader: leader > 0 ? (price / leader - 1) * 100 : 0,
        indexToMedian: marketMedian > 0 ? (price / marketMedian) * 100 : 0,
        premiumToMedian: marketMedian > 0 ? (price / marketMedian - 1) * 100 : 0,
        premiumToChilexpress: chilePrice > 0 ? (price / chilePrice - 1) * 100 : null,
        rank: 0,
      };
    }).sort((a, b) => a.price - b.price)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }, [selectedRows]);

  const leader = competitiveRows[0];
  const marketMedian = median(competitiveRows.map((row) => row.price));
  const marketMax = competitiveRows.length ? Math.max(...competitiveRows.map((row) => row.price)) : 0;
  const spread = leader ? marketMax - leader.price : 0;
  const chilexpressRow = competitiveRows.find((row) => row.company === "Chilexpress") || null;

  const correosRows = useMemo(() => channelRows
    .filter((row) => companyName(row.providerGroup) === "CorreosChile")
    .sort((a, b) => {
      const destination = String(a.destinationLabel || "").localeCompare(String(b.destinationLabel || ""), "es");
      if (destination !== 0) return destination;
      const weight = n(a.referenceWeightKg) - n(b.referenceWeightKg);
      if (weight !== 0) return weight;
      return a.providerGroup.localeCompare(b.providerGroup, "es");
    }), [channelRows]);

  const correosPrices = correosRows.map((row) => n(row.medianShipmentPrice)).filter((value) => value > 0);
  const correosObserved = allRows.filter((row) =>
    companyName(row.providerGroup) === "CorreosChile" && row.sourceChannel === "B2B observado"
  );

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
      if (!marketResponse.ok || !publicResponse.ok || !annexResponse.ok) throw new Error("Una de las fuentes no pudo actualizarse");
      setNotice("Fuentes actualizadas. La tabla recalculó premium, price index y brechas con las últimas observaciones.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando fuentes");
    } finally {
      setRefreshing(false);
    }
  };

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>COURIER & LOGISTICS · COMPETITIVE PRICING</div>
        <h1>Matriz competitiva</h1>
        <p>Comparación de precios por perfil homogéneo. La tabla calcula automáticamente premium/descuento contra el líder, brecha en pesos, índice contra la mediana y posición competitiva.</p>
      </div>
      <div className={styles.sourceBadge}><i/> PRECIOS VERIFICADOS</div>
    </div>

    <div className={styles.segmentTabs}>
      <button type="button" className={layer === "b2c" ? styles.active : ""} onClick={() => setLayer("b2c")}>
        B2C
        <span>Tarifa pública / consumidor</span>
      </button>
      <button type="button" className={layer === "b2b" ? styles.active : ""} onClick={() => setLayer("b2b")}>
        B2B
        <span>Pyme, emprendedores y compras públicas</span>
      </button>
    </div>

    {layer === "b2c" ? <B2CRegionalPricing/> : <>
    <div className={styles.filters}>
      {layer === "b2b" ? <label>Fuente B2B
        <select value={channel} onChange={(event) => setChannel(event.target.value as B2BChannel)}>
          <option value="Pyme / Emprendedores">Pyme / Emprendedores</option>
          <option value="B2B observado">Mercado Público observado</option>
        </select>
      </label> : null}
      <label className={styles.profileSelect}>Perfil comparable
        <select value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}>
          {profiles.map((profile) => <option value={profile.key} key={profile.key}>
            {profile.label} · {profile.companies} empresa{profile.companies === 1 ? "" : "s"}
          </option>)}
        </select>
      </label>
      <label>Período
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={90}>90 días</option>
          <option value={180}>180 días</option>
          <option value={365}>12 meses</option>
          <option value={730}>24 meses</option>
        </select>
      </label>
      {layer === "b2b" && channel === "Pyme / Emprendedores" ? <label className={styles.check}>
        <input type="checkbox" checked={showAllPlans} onChange={(event) => setShowAllPlans(event.target.checked)}/>
        Mostrar todos los tiers / planes
      </label> : null}
      <button type="button" className={styles.refresh} onClick={refresh} disabled={refreshing}>
        {refreshing ? "Actualizando…" : "Actualizar fuentes"}
      </button>
    </div>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Cargando pricing competitivo…</div> : null}

    {!loading ? <>
      <div className={styles.kpis}>
        <article className={styles.kpi}>
          <span>Líder de precio</span>
          <strong>{leader ? leader.company : "—"}</strong>
          <small>{leader ? money.format(leader.price) : "sin comparación"}</small>
        </article>
        <article className={styles.kpi}>
          <span>Mediana mercado</span>
          <strong>{marketMedian ? money.format(marketMedian) : "—"}</strong>
          <small>benchmark = 100</small>
        </article>
        <article className={styles.kpi}>
          <span>Spread mercado</span>
          <strong>{spread ? money.format(spread) : "—"}</strong>
          <small>máximo menos mínimo</small>
        </article>
        <article className={styles.kpi}>
          <span>Empresas comparables</span>
          <strong>{nf.format(new Set(competitiveRows.map((row) => row.company)).size)}</strong>
          <small>{nf.format(competitiveRows.length)} plan(es) visibles</small>
        </article>
        <article className={styles.kpi}>
          <span>Chilexpress vs líder</span>
          <strong>{chilexpressRow ? premiumCopy(chilexpressRow.premiumToLeader) : "—"}</strong>
          <small>{chilexpressRow ? `${money.format(chilexpressRow.gapToLeader)} de brecha` : "no está en este perfil"}</small>
        </article>
      </div>

      <article className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <span>{`B2B · ${channel.toUpperCase()}`}</span>
            <h2>{competitiveRows[0] ? profileLabel(competitiveRows[0]) : "Sin perfil comparable"}</h2>
            <p>Premium positivo = más caro que el benchmark. Índice 100 = mediana del mercado.</p>
          </div>
        </header>

        {competitiveRows.length ? <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Pos.</th>
                  <th>Empresa</th>
                  <th>Plan / canal</th>
                  <th>Precio</th>
                  <th>Brecha vs líder</th>
                  <th>Premium vs líder</th>
                  <th>Price index</th>
                  <th>Vs mediana</th>
                  <th>Vs Chilexpress</th>
                  <th>$/kg</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {competitiveRows.map((row) => <tr key={`${row.profileKey}-${row.providerGroup}`}>
                  <td><span className={`${styles.rank} ${row.rank === 1 ? styles.leader : ""}`}>#{row.rank}</span></td>
                  <td className={styles.companyCell}>
                    <b>{row.company}</b>
                    <small>{n(row.confidence) ? `${nf.format(n(row.confidence))}% confianza` : "sin score"}</small>
                  </td>
                  <td className={styles.companyCell}>
                    <b>{planLabel(row.providerGroup)}</b>
                    <small>{row.sourceChannel || "—"}</small>
                  </td>
                  <td className={styles.price}>
                    <strong>{money.format(row.price)}</strong>
                    <small>{nf.format(n(row.observations))} obs.</small>
                  </td>
                  <td>{row.gapToLeader === 0 ? "—" : money.format(row.gapToLeader)}</td>
                  <td><span className={`${styles.badge} ${premiumClass(row.premiumToLeader)}`}>{premiumCopy(row.premiumToLeader)}</span></td>
                  <td><span className={`${styles.badge} ${premiumClass(row.indexToMedian - 100)}`}>{pct.format(row.indexToMedian)}</span></td>
                  <td><span className={`${styles.badge} ${premiumClass(row.premiumToMedian)}`}>{premiumCopy(row.premiumToMedian)}</span></td>
                  <td><span className={`${styles.badge} ${premiumClass(row.premiumToChilexpress)}`}>{premiumCopy(row.premiumToChilexpress)}</span></td>
                  <td>{row.pricePerKg ? money.format(row.pricePerKg) : "—"}</td>
                  <td>{date(row.latestDate)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className={styles.insight}>
            <div>
              <span>Lectura ejecutiva</span>
              <b>{leader.company} lidera este perfil con {money.format(leader.price)}. La dispersión entre mínimo y máximo es {money.format(spread)}.</b>
            </div>
            <div>
              <span>Mayor premium</span>
              <b>{competitiveRows.at(-1)?.company || "—"} {competitiveRows.length > 1 ? premiumCopy(competitiveRows.at(-1)?.premiumToLeader ?? null) : "—"}</b>
            </div>
            <div>
              <span>Chilexpress</span>
              <b>{chilexpressRow ? `#${chilexpressRow.rank} · ${premiumCopy(chilexpressRow.premiumToLeader)} vs líder` : "Sin dato comparable en este perfil"}</b>
            </div>
          </div>
        </> : <div className={styles.empty}>
          <b>No hay suficientes datos comparables para este filtro.</b>
          Prueba otro perfil o activa todos los planes B2B.
        </div>}
      </article>

      <details className={styles.correos} open={companyName(leader?.providerGroup || "") === "CorreosChile"}>
        <summary>CorreosChile · data disponible ({nf.format(correosRows.length)} referencias) ▾</summary>
        <div className={styles.correosBody}>
          <div className={styles.correosIntro}>
            <article>
              <span>{channel === "Pyme / Emprendedores" ? "Aliados / Emprendedores" : "B2B observado"}</span>
              <strong>{nf.format(correosRows.length)} referencias</strong>
              <small>{correosPrices.length ? `${money.format(Math.min(...correosPrices))} – ${money.format(Math.max(...correosPrices))}` : "sin precios para este filtro"}</small>
            </article>
            <article>
              <span>Mercado Público</span>
              <strong>{nf.format(correosObserved.length)} tarifas</strong>
              <small>Ofertas económicas unitarias verificadas; no montos globales.</small>
            </article>
            <article>
              <span>Programa Aliados</span>
              <strong>10%–25%</strong>
              <small>10% nuevo emprendedor; 15% desde 20 envíos; 20% desde 50; 25% desde 100.</small>
            </article>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.correosTable}>
              <thead>
                <tr><th>Plan / fuente</th><th>Zona / destino</th><th>Peso</th><th>Servicio</th><th>Precio</th><th>$/kg</th><th>Fecha</th></tr>
              </thead>
              <tbody>
                {correosRows.slice(0, 140).map((row) => <tr key={`correos-${row.profileKey}-${row.providerGroup}`}>
                  <td><b>{planLabel(row.providerGroup)}</b><br/>{row.sourceChannel || "—"}</td>
                  <td>{row.originLabel || "—"} → {row.destinationLabel || "—"}</td>
                  <td>{n(row.referenceWeightKg) ? `${pct.format(n(row.referenceWeightKg))} kg` : row.weightBand || "—"}</td>
                  <td>{row.serviceType || "Courier"}</td>
                  <td><b>{money.format(n(row.medianShipmentPrice))}</b></td>
                  <td>{n(row.medianPricePerKg) ? money.format(n(row.medianPricePerKg)) : "—"}</td>
                  <td>{date(row.latestDate)}</td>
                </tr>)}
                {!correosRows.length ? <tr><td colSpan={7}>No hay datos CorreosChile en esta capa.</td></tr> : null}
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
        Los premiums solo se calculan dentro del perfil seleccionado. La tarifa pública CorreosChile Express AM se conserva por zona oficial INTRA/CERCA/LEJOS y no se fuerza a una ciudad específica; los planes Aliados se derivan únicamente de descuentos publicados sobre esa base.
      </div>
    </> : null}
    </>}
  </section>;
}
