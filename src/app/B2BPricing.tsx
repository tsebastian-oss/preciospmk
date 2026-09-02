"use client";

// COURIER_SEGMENTED_ACCORDION_V1
// COURIER_PRICE_HISTORY_V1
import { useCallback, useEffect, useMemo, useState } from "react";
import B2BProfitabilitySimulator from "./B2BProfitabilitySimulator";
import styles from "./CourierPriceHistory.module.css";

type Layer = "b2c" | "b2b";
type B2BChannel = "Pyme / Emprendedores" | "Mercado Público";

type Numeric = number | string | null;
type TimePoint = {
  date: string;
  company: string;
  plan: string;
  channel: string;
  preferredPlan: boolean;
  origin: string | null;
  destination: string | null;
  weightBand: string | null;
  weightKg: Numeric;
  serviceType: string | null;
  priceClp: Numeric;
  pricePerKgClp: Numeric;
  observations: Numeric;
  confidence: Numeric;
};
type TimeSeriesPayload = {
  layer: Layer;
  summary?: {
    points?: Numeric;
    companies?: Numeric;
    dates?: Numeric;
    firstDate?: string | null;
    lastDate?: string | null;
  };
  options?: Record<string, unknown>;
  points: TimePoint[];
  error?: string;
};
type SeriesPoint = { date: string; price: number; observations: number; confidence: number; plan: string };
type CompanySeries = { company: string; points: SeriesPoint[] };
type Profile = {
  key: string;
  label: string;
  origin: string;
  destination: string;
  weightBand: string;
  weightKg: number;
  serviceType: string;
  companies: number;
  dates: number;
  points: number;
};

const nf = new Intl.NumberFormat("es-CL");
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const SERIES_COLORS: Record<string, string> = {
  "Blue Express": "#67a7ff",
  "Chilexpress": "#f0c15b",
  "Starken": "#7dd3a8",
  "CorreosChile": "#b895f1",
};
const FALLBACK_COLORS = ["#e58b7c", "#8fc4c8", "#c6a36e", "#8fa7d8", "#cf91bd"];

function n(value: Numeric | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function median(values: number[]) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function fmtDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "2-digit" }).format(parsed);
}
function companyColor(company: string, index: number) {
  return SERIES_COLORS[company] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}
function weightLabel(point: TimePoint) {
  const weight = n(point.weightKg);
  return weight > 0 ? `${decimal.format(weight)} kg` : (point.weightBand || "sin peso");
}
function profileKey(point: TimePoint) {
  return [
    point.origin || "—",
    point.destination || "—",
    n(point.weightKg) > 0 ? `${n(point.weightKg)}kg` : (point.weightBand || "sin peso"),
    point.serviceType || "Courier",
  ].join("|||");
}
function profileLabel(point: TimePoint) {
  return `${point.origin || "—"} → ${point.destination || "—"} · ${weightLabel(point)} · ${point.serviceType || "Courier"}`;
}
function isComparableBasePoint(point: TimePoint, layer: Layer, channel: B2BChannel) {
  if (layer === "b2c") return point.channel === "Tarifa pública";
  if (channel === "Mercado Público") return point.channel === "Mercado Público";
  return point.channel === "Pyme / Emprendedores" && point.preferredPlan;
}
function deltaPct(points: SeriesPoint[]) {
  if (points.length < 2) return null;
  const previous = points[points.length - 2].price;
  const latest = points[points.length - 1].price;
  if (!previous) return null;
  return (latest / previous - 1) * 100;
}

export default function B2BPricing() {
  const [layer, setLayer] = useState<Layer>("b2b");
  const [channel, setChannel] = useState<B2BChannel>("Pyme / Emprendedores");
  const [days, setDays] = useState(365);
  const [payload, setPayload] = useState<TimeSeriesPayload | null>(null);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/b2b-pricing/timeseries?category=courier&days=${days}&layer=${layer}&live=${Date.now()}`,
        { cache: "no-store" },
      );
      const result = await response.json() as TimeSeriesPayload;
      if (!response.ok) throw new Error(result.error || "No fue posible cargar el histórico");
      setPayload(result);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando histórico de courier");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [days, layer]);

  useEffect(() => { void load(); }, [load]);

  const candidatePoints = useMemo(
    () => (payload?.points ?? []).filter((point) => isComparableBasePoint(point, layer, channel)),
    [payload, layer, channel],
  );

  const profiles = useMemo<Profile[]>(() => {
    const map = new Map<string, { sample: TimePoint; companies: Set<string>; dates: Set<string>; points: number }>();
    for (const point of candidatePoints) {
      const key = profileKey(point);
      const existing = map.get(key);
      if (existing) {
        existing.companies.add(point.company);
        existing.dates.add(point.date);
        existing.points += 1;
      } else {
        map.set(key, {
          sample: point,
          companies: new Set([point.company]),
          dates: new Set([point.date]),
          points: 1,
        });
      }
    }
    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      label: profileLabel(value.sample),
      origin: value.sample.origin || "—",
      destination: value.sample.destination || "—",
      weightBand: value.sample.weightBand || "—",
      weightKg: n(value.sample.weightKg),
      serviceType: value.sample.serviceType || "Courier",
      companies: value.companies.size,
      dates: value.dates.size,
      points: value.points,
    })).sort((a, b) => {
      const scoreA = a.companies * 100000 + a.dates * 1000 + a.points;
      const scoreB = b.companies * 100000 + b.dates * 1000 + b.points;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.label.localeCompare(b.label, "es");
    });
  }, [candidatePoints]);

  useEffect(() => {
    if (!profiles.length) {
      setSelectedProfile("");
      return;
    }
    if (!profiles.some((profile) => profile.key === selectedProfile)) setSelectedProfile(profiles[0].key);
  }, [profiles, selectedProfile]);

  const selectedPoints = useMemo(
    () => candidatePoints.filter((point) => profileKey(point) === selectedProfile),
    [candidatePoints, selectedProfile],
  );

  const series = useMemo<CompanySeries[]>(() => {
    const byCompany = new Map<string, Map<string, TimePoint[]>>();
    for (const point of selectedPoints) {
      const dates = byCompany.get(point.company) || new Map<string, TimePoint[]>();
      const dayPoints = dates.get(point.date) || [];
      dayPoints.push(point);
      dates.set(point.date, dayPoints);
      byCompany.set(point.company, dates);
    }
    return Array.from(byCompany.entries()).map(([company, dates]) => ({
      company,
      points: Array.from(dates.entries()).map(([date, dayPoints]) => ({
        date,
        price: median(dayPoints.map((point) => n(point.priceClp)).filter((value) => value > 0)),
        observations: dayPoints.reduce((sum, point) => sum + n(point.observations), 0),
        confidence: median(dayPoints.map((point) => n(point.confidence)).filter((value) => value > 0)),
        plan: dayPoints[0]?.plan || company,
      })).filter((point) => point.price > 0).sort((a, b) => a.date.localeCompare(b.date)),
    })).filter((item) => item.points.length).sort((a, b) => a.company.localeCompare(b.company, "es"));
  }, [selectedPoints]);

  const dates = useMemo(
    () => Array.from(new Set(series.flatMap((item) => item.points.map((point) => point.date)))).sort(),
    [series],
  );

  const latestCards = useMemo(
    () => series.map((item) => ({
      ...item,
      latest: item.points[item.points.length - 1],
      delta: deltaPct(item.points),
    })),
    [series],
  );

  const chart = useMemo(() => {
    const width = 1000;
    const height = 420;
    const left = 88;
    const right = 28;
    const top = 28;
    const bottom = 58;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const allPrices = series.flatMap((item) => item.points.map((point) => point.price));
    if (!allPrices.length) return null;
    let minY = Math.min(...allPrices);
    let maxY = Math.max(...allPrices);
    if (minY === maxY) {
      minY = Math.max(0, minY * 0.85);
      maxY = maxY * 1.15 || 1000;
    } else {
      const pad = (maxY - minY) * 0.14;
      minY = Math.max(0, minY - pad);
      maxY += pad;
    }
    const dateMs = dates.map((value) => new Date(`${value}T12:00:00`).getTime());
    const minX = dateMs.length ? Math.min(...dateMs) : 0;
    const maxX = dateMs.length ? Math.max(...dateMs) : minX;
    const x = (date: string) => {
      if (maxX === minX) return left + plotWidth / 2;
      const value = new Date(`${date}T12:00:00`).getTime();
      return left + ((value - minX) / (maxX - minX)) * plotWidth;
    };
    const y = (price: number) => top + (1 - (price - minY) / (maxY - minY)) * plotHeight;
    const yTicks = Array.from({ length: 5 }, (_, index) => minY + ((maxY - minY) * index) / 4).reverse();
    const xLabels = dates.length <= 6
      ? dates
      : dates.filter((_, index) => index === 0 || index === dates.length - 1 || index % Math.ceil(dates.length / 5) === 0);
    return { width, height, left, right, top, bottom, plotWidth, plotHeight, minY, maxY, x, y, yTicks, xLabels };
  }, [series, dates]);

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
      setNotice("Fuentes actualizadas. El gráfico incorpora solamente observaciones verificadas con fecha.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando fuentes");
    } finally {
      setRefreshing(false);
    }
  };

  const selectedProfileData = profiles.find((profile) => profile.key === selectedProfile);
  const latestDate = dates.at(-1) || null;

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>COURIER & LOGISTICS · PRICE HISTORY</div>
        <h1>Evolución de precios</h1>
        <p>Una línea por empresa. El eje X muestra la fecha observada y el eje Y el precio del mismo perfil de envío, sin mezclar rutas, pesos ni servicios distintos.</p>
      </div>
      <div className={styles.sourceBadge}><i/> HISTÓRICO VERIFICADO</div>
    </div>

    <div className={styles.segmentTabs}>
      <button type="button" className={layer === "b2c" ? styles.active : ""} onClick={() => setLayer("b2c")}>
        B2C
        <span>Tarifa pública / consumidor</span>
      </button>
      <button type="button" className={layer === "b2b" ? styles.active : ""} onClick={() => setLayer("b2b")}>
        B2B
        <span>Pyme, emprendedores y contratos</span>
      </button>
    </div>

    <div className={styles.filters}>
      {layer === "b2b" ? <label>Fuente B2B
        <select value={channel} onChange={(event) => setChannel(event.target.value as B2BChannel)}>
          <option value="Pyme / Emprendedores">Pyme / Emprendedores</option>
          <option value="Mercado Público">Mercado Público observado</option>
        </select>
      </label> : null}
      <label className={styles.profileSelect}>Perfil comparable
        <select value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}>
          {profiles.map((profile) => <option value={profile.key} key={profile.key}>
            {profile.label} · {profile.companies} emp.
          </option>)}
        </select>
      </label>
      <label>Período
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={90}>90 días</option>
          <option value={180}>180 días</option>
          <option value={365}>12 meses</option>
          <option value={730}>24 meses</option>
          <option value={1095}>36 meses</option>
        </select>
      </label>
      <button type="button" className={styles.refresh} onClick={refresh} disabled={refreshing}>
        {refreshing ? "Actualizando…" : "Actualizar fuentes"}
      </button>
    </div>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {loading ? <div className={styles.loading}>Cargando histórico de precios…</div> : null}

    {!loading ? <article className={styles.chartCard}>
      <header className={styles.chartHeader}>
        <div>
          <span>{layer === "b2c" ? "B2C · TARIFA PÚBLICA" : `B2B · ${channel.toUpperCase()}`}</span>
          <h2>{selectedProfileData?.label || "Sin perfil comparable"}</h2>
          <p>Las líneas unen observaciones reales. Un tramo entre dos fechas no implica que el precio haya permanecido vigente todos los días intermedios.</p>
        </div>
      </header>

      <div className={styles.kpiRow}>
        <div className={styles.kpi}><span>Empresas visibles</span><strong>{nf.format(series.length)}</strong></div>
        <div className={styles.kpi}><span>Fechas observadas</span><strong>{nf.format(dates.length)}</strong></div>
        <div className={styles.kpi}><span>Última observación</span><strong>{latestDate ? fmtDate(latestDate) : "—"}</strong></div>
        <div className={styles.kpi}><span>Rango actual</span><strong>{latestCards.length ? `${compactMoney.format(Math.min(...latestCards.map((item) => item.latest.price)))}–${compactMoney.format(Math.max(...latestCards.map((item) => item.latest.price)))}` : "—"}</strong></div>
      </div>

      {chart && series.length ? <>
        <div className={styles.chartWrap}>
          <svg className={styles.chartSvg} viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Evolución histórica de precios por empresa">
            {chart.yTicks.map((tick) => {
              const yy = chart.y(tick);
              return <g key={tick}>
                <line className={styles.gridLine} x1={chart.left} x2={chart.width - chart.right} y1={yy} y2={yy}/>
                <text className={styles.yLabel} x={chart.left - 12} y={yy + 4} textAnchor="end">{compactMoney.format(tick)}</text>
              </g>;
            })}
            <line className={styles.axisLine} x1={chart.left} x2={chart.left} y1={chart.top} y2={chart.height - chart.bottom}/>
            <line className={styles.axisLine} x1={chart.left} x2={chart.width - chart.right} y1={chart.height - chart.bottom} y2={chart.height - chart.bottom}/>
            {chart.xLabels.map((value) => {
              const xx = chart.x(value);
              return <text className={styles.axisText} key={value} x={xx} y={chart.height - 24} textAnchor="middle">{fmtDate(value)}</text>;
            })}
            {series.map((item, index) => {
              const color = companyColor(item.company, index);
              const points = item.points.map((point) => `${chart.x(point.date)},${chart.y(point.price)}`).join(" ");
              return <g key={item.company}>
                {item.points.length > 1 ? <polyline className={styles.seriesLine} points={points} stroke={color}/> : null}
                {item.points.map((point) => <circle
                  key={`${item.company}-${point.date}`}
                  className={styles.seriesPoint}
                  cx={chart.x(point.date)}
                  cy={chart.y(point.price)}
                  r={6}
                  fill={color}
                >
                  <title>{item.company} · {fmtDate(point.date)} · {money.format(point.price)} · {point.plan}</title>
                </circle>)}
              </g>;
            })}
          </svg>
        </div>

        <div className={styles.legend}>
          {series.map((item, index) => <div className={styles.legendItem} key={item.company}>
            <i className={styles.legendDot} style={{ background: companyColor(item.company, index) }}/>
            <b>{item.company}</b>
          </div>)}
        </div>

        <div className={styles.latestGrid}>
          {latestCards.map((item, index) => {
            const delta = item.delta;
            const deltaClass = delta === null || Math.abs(delta) < 0.05 ? styles.deltaFlat : delta > 0 ? styles.deltaUp : styles.deltaDown;
            return <article className={styles.latestCard} key={item.company}>
              <div className={styles.latestTop}><i style={{ background: companyColor(item.company, index) }}/><b>{item.company}</b></div>
              <strong>{money.format(item.latest.price)}</strong>
              <small>{fmtDate(item.latest.date)} · {item.latest.plan}</small>
              <small className={deltaClass}>
                {delta === null ? "Primer punto histórico" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs observación anterior`}
              </small>
            </article>;
          })}
        </div>
      </> : <div className={styles.emptyChart}>
        <b>No hay histórico comparable para este filtro.</b>
        El gráfico no rellena fechas ni precios que no hayan sido observados.
      </div>}
    </article> : null}

    {!loading && series.length ? <details className={styles.history}>
      <summary>Ver detalle histórico ▾</summary>
      <div className={styles.historyBody}>
        <table className={styles.historyTable}>
          <thead><tr><th>Fecha</th><th>Empresa</th><th>Plan / fuente</th><th>Precio</th><th>Obs.</th><th>Confianza</th></tr></thead>
          <tbody>
            {series.flatMap((item) => item.points.map((point) => ({ company: item.company, ...point })))
              .sort((a, b) => b.date.localeCompare(a.date) || a.company.localeCompare(b.company, "es"))
              .map((point) => <tr key={`${point.company}-${point.date}-${point.plan}`}>
                <td>{fmtDate(point.date)}</td>
                <td><b>{point.company}</b></td>
                <td>{point.plan}</td>
                <td><b>{money.format(point.price)}</b></td>
                <td>{nf.format(point.observations)}</td>
                <td>{point.confidence ? `${decimal.format(point.confidence)}%` : "—"}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </details> : null}

    <details className={styles.profitability}>
      <summary>Simulador de rentabilidad ▾</summary>
      <div className={styles.profitabilityBody}><B2BProfitabilitySimulator/></div>
    </details>

    <div className={styles.footnote}>
      B2C = tarifa pública/consumidor. B2B Pyme = un plan base comparable por empresa: Blue Ecommerce 1–500, Chilexpress Emprendedores y Starken Tarifa Simple. Los tiers Partner de Starken se mantienen en la base, pero no se superponen en el gráfico principal para evitar cuatro líneas de la misma empresa.
    </div>
  </section>;
}
