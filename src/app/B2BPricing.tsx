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

type B2BTimeSeriesPoint = {
  date?: string | null;
  company?: string | null;
  plan?: string | null;
  channel?: string | null;
  preferredPlan?: boolean | null;
  origin?: string | null;
  destination?: string | null;
  weightBand?: string | null;
  weightKg?: Numeric;
  serviceType?: string | null;
  priceClp?: Numeric;
  observations?: Numeric;
  confidence?: Numeric;
};

type B2BTimeSeriesPayload = {
  points?: B2BTimeSeriesPoint[];
  error?: string;
};

type MacroZone = "Norte" | "Centro" | "Sur";

type RegionalB2BCell = {
  price: number;
  confidence: number;
  destinations: number;
  observations: number;
  channel: string;
  plan: string;
};

const B2B_COMPANIES = ["Chilexpress", "Starken", "Blue Express", "CorreosChile"] as const;
const MACRO_ZONES: MacroZone[] = ["Norte", "Centro", "Sur"];
const B2B_MIN_SOURCE_CONFIDENCE = 90;
const B2B_MIN_CELL_CONFIDENCE = 82;

const ZONE_REFERENCE_DESTINATIONS: Record<MacroZone, string[]> = {
  Norte: ["Arica", "Iquique", "Antofagasta", "Copiapó", "La Serena"],
  Centro: ["Santiago", "Valparaíso", "Rancagua", "Talca"],
  Sur: ["Chillán", "Concepción", "Temuco", "Valdivia", "Puerto Montt"],
};

const COMPANY_PRIMARY_PYME_PLAN: Record<string, string[]> = {
  Chilexpress: ["Chilexpress"],
  "Blue Express": ["Blue Express Ecommerce 1–500", "Blue Express B2C / Público"],
  Starken: ["Starken Tarifa Simple"],
  CorreosChile: [
    "CorreosChile Aliados Bronce 10%",
    "CorreosChile Aliados Plata 15%",
    "CorreosChile Aliados Oro 20%",
    "CorreosChile Aliados Platino 25%",
  ],
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

function cleanText(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/\s+/g, " ")
    .trim();
}

function macroZoneForDestination(value: string | null | undefined): MacroZone | null {
  const key = cleanText(value);
  if (!key || key.startsWith("zona ")) return null;

  if (["arica", "iquique", "antofagasta", "calama", "copiapo", "la serena", "coquimbo", "ovalle"].some((item) => key.includes(item))) return "Norte";
  if (["santiago", "valparaiso", "vina del mar", "rancagua", "talca", "curico", "san antonio", "los andes"].some((item) => key.includes(item))) return "Centro";
  if (["chillan", "concepcion", "los angeles", "temuco", "valdivia", "osorno", "puerto montt", "castro", "coyhaique", "punta arenas"].some((item) => key.includes(item))) return "Sur";
  return null;
}

function lastSixMonthKeys() {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1, 12);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthShortLabel(key: string) {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "short" }).format(parsed).replace(".", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function selectBestPymePlan(company: string, plans: Map<string, B2BTimeSeriesPoint[]>) {
  const preferred = COMPANY_PRIMARY_PYME_PLAN[company] || [];
  for (const wanted of preferred) {
    if (plans.has(wanted)) return { plan: wanted, rows: plans.get(wanted) ?? [] };
  }
  const ranked = Array.from(plans.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    const avgA = a[1].reduce((sum, row) => sum + n(row.confidence), 0) / Math.max(1, a[1].length);
    const avgB = b[1].reduce((sum, row) => sum + n(row.confidence), 0) / Math.max(1, b[1].length);
    return avgB - avgA;
  });
  if (!ranked.length) return null;
  return { plan: ranked[0][0], rows: ranked[0][1] };
}

function buildRegionalB2B(points: B2BTimeSeriesPoint[], monthKeys: string[]) {
  type Bucket = { pymePlans: Map<string, B2BTimeSeriesPoint[]>; enterprise: B2BTimeSeriesPoint[] };
  const buckets = new Map<string, Bucket>();
  const monthSet = new Set(monthKeys);

  for (const point of points) {
    const month = String(point.date || "").slice(0, 7);
    if (!monthSet.has(month)) continue;
    const company = String(point.company || "");
    if (!(B2B_COMPANIES as readonly string[]).includes(company)) continue;

    const weight = n(point.weightKg);
    if (!(weight > 0 && weight <= 0.5001)) continue;
    if (n(point.confidence) < B2B_MIN_SOURCE_CONFIDENCE) continue;

    const origin = cleanText(point.origin);
    if (!origin.includes("santiago")) continue;

    const service = cleanText(point.serviceType);
    const isDomicile = service.includes("domic");
    const isGenericEnterprise = point.channel === "Mercado Público" && !["punto", "sucursal", "agencia"].some((term) => service.includes(term));
    if (!isDomicile && !isGenericEnterprise) continue;

    const zone = macroZoneForDestination(point.destination);
    if (!zone) continue;

    const isPyme = point.channel === "Pyme / Emprendedores";
    const isEnterprise = point.channel === "Mercado Público";
    if (!isPyme && !isEnterprise) continue;
    if (!(n(point.priceClp) > 0)) continue;

    const key = `${zone}|${company}|${month}`;
    const bucket = buckets.get(key) ?? { pymePlans: new Map<string, B2BTimeSeriesPoint[]>(), enterprise: [] };

    if (isPyme) {
      const planKey = String(point.plan || "Pyme");
      bucket.pymePlans.set(planKey, [...(bucket.pymePlans.get(planKey) ?? []), point]);
    } else {
      bucket.enterprise.push(point);
    }
    buckets.set(key, bucket);
  }

  const cells = new Map<string, RegionalB2BCell>();

  for (const [key, bucket] of buckets.entries()) {
    const [, company] = key.split("|");
    const chosenPyme = selectBestPymePlan(company, bucket.pymePlans);
    const selected = chosenPyme?.rows?.length ? chosenPyme.rows : bucket.enterprise;
    if (!selected.length) continue;

    const sorted = [...selected].sort((a, b) => n(a.priceClp) - n(b.priceClp));
    const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
    const robust = trim > 0 ? sorted.slice(trim, sorted.length - trim) : sorted;

    let weightedPrice = 0;
    let weightedConfidence = 0;
    let totalWeight = 0;
    let observations = 0;
    const destinations = new Set<string>();

    for (const point of robust) {
      const confidence = n(point.confidence);
      const weightFactor = Math.max(0.5, confidence / 100);
      weightedPrice += n(point.priceClp) * weightFactor;
      weightedConfidence += confidence * weightFactor;
      totalWeight += weightFactor;
      observations += Math.max(1, n(point.observations));
      if (point.destination) destinations.add(cleanText(point.destination));
    }

    if (!(totalWeight > 0)) continue;

    const [zone] = key.split("|") as [MacroZone, string, string];
    const sourceConfidence = weightedConfidence / totalWeight;
    const targetCount = ZONE_REFERENCE_DESTINATIONS[zone].length;
    const coverage = Math.min(100, (destinations.size / Math.max(1, targetCount)) * 100);
    const sourceQuality = chosenPyme?.rows?.length ? 100 : 92;
    const cellConfidence = Math.round(sourceConfidence * 0.72 + coverage * 0.23 + sourceQuality * 0.05);
    if (cellConfidence < B2B_MIN_CELL_CONFIDENCE) continue;

    cells.set(key, {
      price: Math.round(weightedPrice / totalWeight),
      confidence: cellConfidence,
      destinations: destinations.size,
      observations,
      channel: chosenPyme?.rows?.length ? "Pyme" : "Empresa",
      plan: chosenPyme?.plan || "Mercado Público",
    });
  }

  return cells;
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
  const [regionalPoints, setRegionalPoints] = useState<B2BTimeSeriesPoint[]>([]);
  const [regionalLoading, setRegionalLoading] = useState(false);

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

  const loadRegional = useCallback(async () => {
    setRegionalLoading(true);
    try {
      const response = await fetch(
        "/api/b2b-pricing/timeseries?category=courier&days=1095&layer=b2b",
        { cache: "no-store" },
      );
      const result = await response.json() as B2BTimeSeriesPayload;
      if (!response.ok) throw new Error(result.error || "No fue posible cargar histórico regional B2B");
      setRegionalPoints(result.points ?? []);
    } catch {
      setRegionalPoints([]);
    } finally {
      setRegionalLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (layer === "b2b") void loadRegional();
  }, [layer, loadRegional]);

  const regionalMonths = useMemo(() => lastSixMonthKeys(), []);
  const regionalCells = useMemo(
    () => buildRegionalB2B(regionalPoints, regionalMonths),
    [regionalPoints, regionalMonths],
  );

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
      await Promise.all([load(), loadRegional()]);
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
    <article className={`${styles.card} ${styles.regionalCard}`}>
      <header className={styles.regionalHeader}>
        <div>
          <span className={styles.eyebrow}>B2B · MACROZONAS</span>
          <h2>Precio promedio censado por zona</h2>
          <p>Benchmark homogéneo: origen Santiago, paquete ≤ 0,5 kg, entrega a domicilio y tarifa Pyme/Empresa. Se prioriza Pyme; si no existe, se usa evidencia empresarial.</p>
        </div>
        <div className={styles.regionalRules}>
          <span>≤ 0,5 KG</span>
          <span>DOMICILIO</span>
          <span>ORIGEN SANTIAGO</span>
          <span>FUENTE ≥ 90%</span>
        </div>
      </header>

      {regionalLoading ? <div className={styles.loading}>Calculando matriz B2B de alta confianza…</div> : null}

      <div className={styles.regionalStack}>
        {MACRO_ZONES.map((zone) => <section className={styles.regionBlock} key={zone}>
          <div className={styles.regionBlockHeader}>
            <div><span>MACROZONA</span><h3>{zone}</h3></div>
            <small>{ZONE_REFERENCE_DESTINATIONS[zone].join(" · ")}</small>
          </div>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.regionalTable}`}>
              <thead>
                <tr><th>Marca</th>{regionalMonths.map((month) => <th key={`${zone}-${month}`}>{monthShortLabel(month)}</th>)}</tr>
              </thead>
              <tbody>
                {B2B_COMPANIES.map((company) => <tr key={`${zone}-${company}`}>
                  <td><strong>{company === "CorreosChile" ? "Correos Chile" : company}</strong></td>
                  {regionalMonths.map((month) => {
                    const cell = regionalCells.get(`${zone}|${company}|${month}`);
                    return <td
                      key={`${zone}-${company}-${month}`}
                      className={cell ? styles.regionalCell : styles.regionalEmpty}
                      title={cell ? `${cell.plan} · ${cell.observations} observaciones · ${cell.destinations} destinos` : "Sin censo comparable"}
                    >
                      {cell ? <>
                        <strong>{money.format(cell.price)}</strong>
                        <small>{cell.confidence}% confianza · {cell.destinations} destino{cell.destinations === 1 ? "" : "s"}</small>
                        <em>{cell.channel}</em>
                      </> : <>
                        <strong>—</strong>
                        <small>sin censo comparable</small>
                      </>}
                    </td>;
                  })}
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>)}
      </div>

      <div className={styles.methodNote}>
        Promedio robusto ponderado por confianza. No se imputan meses ni rutas inexistentes y no se mezclan tarifas punto/sucursal con domicilio. Si una marca no tiene Pyme comparable, se usa Empresa/Mercado Público. Si la confianza es insuficiente, se muestra “—”.
      </div>
    </article>

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
