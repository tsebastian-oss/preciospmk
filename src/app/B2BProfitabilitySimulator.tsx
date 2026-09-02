"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./B2BProfitabilitySimulator.module.css";

type CompetitorName = "Chilexpress" | "Starken" | "Blue Express" | "CorreosChile";
type CostScenario = "Eficiente" | "Base" | "Exigente";

type RegionSnapshot = {
  region: string;
  zone: string;
  providerCount: number;
  prices?: Record<string, number>;
  products?: Record<string, string>;
  matchQuality?: Record<string, string>;
  leader?: string | null;
  leaderPrice?: number | null;
  latestDate?: string | null;
};

type HistoryPoint = {
  provider: CompetitorName;
  destination: string;
  price: number;
  observedAt: string;
  observedDate: string;
  sourceUrl?: string | null;
  serviceType?: string | null;
  deliveryType?: string | null;
};

type ProfitabilityPayload = {
  weightKg: number;
  service: string;
  snapshot?: {
    origin?: string;
    weightKg?: number;
    delivery?: string;
    service?: string;
    regions?: RegionSnapshot[];
    slaMap?: Record<string, string>;
  } | null;
  history?: HistoryPoint[];
  observedPriceNotice?: string;
  error?: string;
};

type CompetitorProfile = {
  name: CompetitorName;
  pickup: number;
  sort: number;
  linehaulFactor: number;
  lastMile: number;
  overhead: number;
  density: number;
};

type SimulationRow = {
  competitor: CompetitorName;
  price: number | null;
  cost: number;
  contribution: number | null;
  margin: number | null;
  priceIndex: number | null;
  density: number;
  product: string | null;
  matchQuality: string | null;
  observedAt: string | null;
  sourceUrl: string | null;
  history: HistoryPoint[];
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

const PROVIDERS: CompetitorProfile[] = [
  { name: "Chilexpress", pickup: 650, sort: 610, linehaulFactor: 1.00, lastMile: 1540, overhead: 720, density: 92 },
  { name: "Starken", pickup: 610, sort: 590, linehaulFactor: 0.98, lastMile: 1510, overhead: 650, density: 84 },
  { name: "Blue Express", pickup: 570, sort: 520, linehaulFactor: 0.94, lastMile: 1320, overhead: 610, density: 108 },
  { name: "CorreosChile", pickup: 600, sort: 640, linehaulFactor: 1.03, lastMile: 1610, overhead: 690, density: 77 },
];

const ROUTES = [
  { key: "Santiago Centro|Arica", destination: "Arica", region: "Arica y Parinacota", km: 2050 },
  { key: "Santiago Centro|Iquique", destination: "Iquique", region: "Tarapacá", km: 1780 },
  { key: "Santiago Centro|Antofagasta", destination: "Antofagasta", region: "Antofagasta", km: 1340 },
  { key: "Santiago Centro|Copiapó", destination: "Copiapó", region: "Atacama", km: 805 },
  { key: "Santiago Centro|La Serena", destination: "La Serena", region: "Coquimbo", km: 470 },
  { key: "Santiago Centro|Valparaíso", destination: "Valparaíso", region: "Valparaíso", km: 120 },
  { key: "Santiago Centro|Santiago Centro", destination: "Santiago Centro", region: "Metropolitana", km: 20 },
  { key: "Santiago Centro|Rancagua", destination: "Rancagua", region: "O’Higgins", km: 90 },
  { key: "Santiago Centro|Talca", destination: "Talca", region: "Maule", km: 255 },
  { key: "Santiago Centro|Chillán", destination: "Chillán", region: "Ñuble", km: 400 },
  { key: "Santiago Centro|Concepción", destination: "Concepción", region: "Biobío", km: 500 },
  { key: "Santiago Centro|Temuco", destination: "Temuco", region: "Araucanía", km: 690 },
  { key: "Santiago Centro|Valdivia", destination: "Valdivia", region: "Los Ríos", km: 850 },
  { key: "Santiago Centro|Puerto Montt", destination: "Puerto Montt", region: "Los Lagos", km: 1030 },
] as const;

const WEIGHTS = [0.5, 3, 6] as const;
const COST_SCENARIO_MULTIPLIER: Record<CostScenario, number> = { Eficiente: 0.91, Base: 1, Exigente: 1.12 };

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function hasPrice(value: number | null | undefined): value is number { return value != null && Number.isFinite(value) && value > 0; }

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function shortAxisDate(value: string) {
  const parsed = new Date(value + "T12:00:00");
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(parsed);
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function B2BProfitabilitySimulator() {
  const [routeKey, setRouteKey] = useState("Santiago Centro|Concepción");
  const [weight, setWeight] = useState<number>(0.5);
  const [scenario, setScenario] = useState<CostScenario>("Base");
  const [selected, setSelected] = useState<CompetitorName>("Chilexpress");
  const [priceAdjustment, setPriceAdjustment] = useState(0);
  const [payload, setPayload] = useState<ProfitabilityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const route = ROUTES.find((item) => item.key === routeKey) ?? ROUTES[10];

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/b2c-pricing/profitability?weight=${weight}`, { cache: "no-store" });
        const result = await response.json() as ProfitabilityPayload;
        if (!response.ok) throw new Error(result.error || "No fue posible cargar precios observados");
        if (!cancelled) {
          setPayload(result);
          setNotice("");
        }
      } catch (error) {
        if (!cancelled) {
          setPayload(null);
          setNotice(error instanceof Error ? error.message : "Error cargando precios observados");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [weight]);

  useEffect(() => { setPriceAdjustment(0); }, [routeKey, weight]);

  const region = payload?.snapshot?.regions?.find((item) => item.region === route.region) ?? null;
  const routeHistory = useMemo(
    () => (payload?.history ?? []).filter((point) => point.destination === route.destination),
    [payload, route.destination],
  );

  const latestHistoryByProvider = useMemo(() => {
    const map = new Map<CompetitorName, HistoryPoint>();
    for (const point of routeHistory) {
      const previous = map.get(point.provider);
      if (!previous || new Date(point.observedAt).getTime() > new Date(previous.observedAt).getTime()) map.set(point.provider, point);
    }
    return map;
  }, [routeHistory]);

  const rawPrices = PROVIDERS
    .map((profile) => Number(region?.prices?.[profile.name] ?? 0))
    .filter((value) => value > 0);
  const marketMedian = median(rawPrices);

  const rows = useMemo<SimulationRow[]>(() => {
    const scenarioFactor = COST_SCENARIO_MULTIPLIER[scenario];
    return PROVIDERS.map((profile) => {
      const observedPrice = Number(region?.prices?.[profile.name] ?? 0);
      const price = observedPrice > 0 ? observedPrice : null;
      const linehaul = (route.km * 2.15 + 380) * profile.linehaulFactor * (1 + (weight - 1) * 0.018);
      const densityEfficiency = clamp(92 / profile.density, 0.78, 1.24);
      const lastMile = profile.lastMile * densityEfficiency;
      const cost = (profile.pickup + profile.sort + linehaul + lastMile + profile.overhead) * scenarioFactor;
      const contribution = price == null ? null : price - cost;
      const margin = price == null ? null : contribution! / price * 100;
      const latest = latestHistoryByProvider.get(profile.name);
      const isCorreos = profile.name === "CorreosChile" && price != null;
      return {
        competitor: profile.name,
        price,
        cost,
        contribution,
        margin,
        priceIndex: price != null && marketMedian ? price / marketMedian * 100 : null,
        density: profile.density,
        product: region?.products?.[profile.name] ?? null,
        matchQuality: region?.matchQuality?.[profile.name] ?? null,
        observedAt: latest?.observedAt ?? (isCorreos ? "2025-10-01T12:00:00-03:00" : null),
        sourceUrl: latest?.sourceUrl ?? (isCorreos ? "https://www.diariooficial.interior.gob.cl/publicaciones/2025/10/01/44263/01/2704814.pdf" : null),
        history: routeHistory.filter((point) => point.provider === profile.name),
      };
    });
  }, [region, route.km, routeHistory, weight, scenario, latestHistoryByProvider, marketMedian]);

  const selectedRow = rows.find((row) => row.competitor === selected) ?? rows[0];
  const adjustedSelectedPrice = hasPrice(selectedRow.price) ? selectedRow.price * (1 + priceAdjustment / 100) : null;
  const adjustedContribution = adjustedSelectedPrice == null ? null : adjustedSelectedPrice - selectedRow.cost;
  const adjustedMargin = adjustedSelectedPrice == null ? null : adjustedContribution! / adjustedSelectedPrice * 100;
  const recommendedPrice = selectedRow.cost / 0.72;

  const availableRows = rows.filter((row) => hasPrice(row.price));
  const marketPrice = availableRows.length ? availableRows.reduce((sum, row) => sum + (row.price ?? 0), 0) / availableRows.length : null;
  const lowestPrice = availableRows.length ? [...availableRows].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0] : null;
  const bestMargin = availableRows.filter((row) => row.margin != null).sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity))[0] ?? null;

  const chartDates = useMemo(() => {
    const values = new Set(routeHistory.map((point) => point.observedDate));
    if (hasPrice(rows.find((row) => row.competitor === "CorreosChile")?.price)) values.add("2025-10-01");
    return [...values].sort();
  }, [routeHistory, rows]);

  const chartSeries = useMemo(() => rows.map((row) => {
    const points = [...row.history];
    if (row.competitor === "CorreosChile" && hasPrice(row.price)) {
      points.push({
        provider: "CorreosChile",
        destination: route.destination,
        price: row.price,
        observedAt: "2025-10-01T12:00:00-03:00",
        observedDate: "2025-10-01",
        sourceUrl: row.sourceUrl,
        serviceType: "Paquete Express Domicilio",
        deliveryType: "DOMICILIO",
      });
    }
    const byDate = new Map(points.map((point) => [point.observedDate, point.price]));
    return { competitor: row.competitor, points: chartDates.map((date) => ({ date, price: byDate.get(date) ?? null })) };
  }), [rows, chartDates, route.destination]);

  const chart = useMemo(() => {
    const all = chartSeries.flatMap((series) => series.points.map((point) => point.price).filter(hasPrice));
    if (!all.length || !chartDates.length) return null;
    const minRaw = Math.min(...all);
    const maxRaw = Math.max(...all);
    const pad = Math.max(250, (maxRaw - minRaw) * 0.10);
    const min = Math.max(0, minRaw - pad);
    const max = maxRaw + pad;
    const width = 760;
    const height = 230;
    const left = 54;
    const right = 18;
    const top = 18;
    const bottom = 34;
    const x = (index: number) => chartDates.length === 1
      ? (left + width - right) / 2
      : left + index * ((width - left - right) / (chartDates.length - 1));
    const y = (value: number) => top + (max - value) / Math.max(1, max - min) * (height - top - bottom);
    return { width, height, min, max, x, y };
  }, [chartSeries, chartDates]);

  return <article className={styles.shell}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>COMPETITIVE PROFITABILITY · OBSERVED</span>
        <h2>Simulador de rentabilidad competitiva</h2>
        <p>Los precios competitivos vienen de tarifas capturadas u oficiales. El costo-to-serve, densidad, contribución y margen siguen siendo estimaciones hasta conectar costos operacionales reales de Chilexpress.</p>
      </div>
      <div className={styles.demoBadge}>PRECIOS OBSERVADOS · COSTOS ESTIMADOS</div>
    </header>

    <div className={styles.controls}>
      <label>Ruta<select value={routeKey} onChange={(event) => setRouteKey(event.target.value)}>{ROUTES.map((item) => <option key={item.key} value={item.key}>Santiago Centro → {item.destination}</option>)}</select></label>
      <label>Peso<select value={weight} onChange={(event) => setWeight(Number(event.target.value))}>{WEIGHTS.map((value) => <option key={value} value={value}>{value} kg</option>)}</select></label>
      <label>Servicio<select value="Estándar" disabled><option>Estándar</option></select></label>
      <label>Escenario costo<select value={scenario} onChange={(event) => setScenario(event.target.value as CostScenario)}><option>Eficiente</option><option>Base</option><option>Exigente</option></select></label>
    </div>

    {notice ? <div className={styles.footnote}><b>Datos:</b> {notice}</div> : null}
    {loading ? <div className={styles.footnote}>Cargando precios observados…</div> : null}

    {!loading && payload ? <>
      <div className={styles.kpis}>
        <div><span>Precio medio observado</span><strong>{marketPrice ? money.format(marketPrice) : "—"}</strong><small>{route.destination} · {availableRows.length}/4 couriers</small></div>
        <div><span>Operador más agresivo</span><strong>{lowestPrice?.competitor ?? "—"}</strong><small>{lowestPrice?.price ? money.format(lowestPrice.price) : "sin comparación"}</small></div>
        <div><span>Mayor margen estimado</span><strong>{bestMargin?.margin != null ? `${percent.format(bestMargin.margin)}%` : "—"}</strong><small>{bestMargin?.competitor ?? "requiere precio observado"}</small></div>
        <div><span>Distancia de referencia</span><strong>{route.km.toLocaleString("es-CL")} km</strong><small>supuesto de costo · {weight} kg</small></div>
      </div>

      <div className={styles.mainGrid}>
        <section className={styles.comparisonCard}>
          <div className={styles.cardHead}><div><span>PRECIO OBSERVADO + ECONOMÍA ESTIMADA</span><h3>Precio, costo y margen por competidor</h3></div><small>Precio = evidencia capturada/oficial · CTE = supuesto operativo</small></div>
          <div className={styles.operatorGrid}>
            {rows.map((row) => <button type="button" key={row.competitor} className={selected === row.competitor ? styles.operatorActive : styles.operator} onClick={() => { setSelected(row.competitor); setPriceAdjustment(0); }}>
              <div className={styles.operatorTitle}><strong>{row.competitor}</strong><span>{row.priceIndex != null ? `Índice ${row.priceIndex.toFixed(0)}` : "Sin precio"}</span></div>
              <div className={styles.priceLine}><span>Precio observado</span><b>{row.price ? money.format(row.price) : "Sin tarifa capturada"}</b></div>
              <div className={styles.priceLine}><span>Costo estimado</span><b>{money.format(row.cost)}</b></div>
              <div className={styles.marginLine}><span>Margen estimado</span><strong className={row.margin == null ? styles.mid : row.margin >= 28 ? styles.good : row.margin >= 18 ? styles.mid : styles.risk}>{row.margin == null ? "—" : `${percent.format(row.margin)}%`}</strong></div>
              <div className={styles.marginTrack}><i style={{ width: `${row.margin == null ? 0 : clamp(row.margin, 0, 45) / 45 * 100}%` }}/></div>
              <div className={styles.priceLine}><span>Fuente / fecha</span><b>{row.observedAt ? shortDate(row.observedAt) : "No disponible"}</b></div>
            </button>)}
          </div>
        </section>

        <aside className={styles.scenarioCard}>
          <div className={styles.cardHead}><div><span>WHAT-IF</span><h3>{selected}</h3></div><small>Sobre precio observado</small></div>
          <div className={styles.sliderValue}><strong>{priceAdjustment > 0 ? "+" : ""}{priceAdjustment}%</strong><span>{hasPrice(selectedRow.price) ? "ajuste sobre tarifa observada" : "sin tarifa para esta combinación"}</span></div>
          <input className={styles.range} type="range" min={-20} max={20} step={1} value={priceAdjustment} disabled={!hasPrice(selectedRow.price)} onChange={(event) => setPriceAdjustment(Number(event.target.value))}/>
          <div className={styles.scenarioStats}>
            <div><span>Nuevo precio</span><b>{adjustedSelectedPrice ? money.format(adjustedSelectedPrice) : "—"}</b></div>
            <div><span>Contribución estimada</span><b>{adjustedContribution != null ? money.format(adjustedContribution) : "—"}</b></div>
            <div><span>Margen estimado</span><b>{adjustedMargin != null ? `${percent.format(adjustedMargin)}%` : "—"}</b></div>
            <div><span>Densidad asumida</span><b>{selectedRow.density} ent./día</b></div>
          </div>
          <div className={styles.recommendation}><span>REFERENCIA DE MODELO</span><strong>Precio para margen 28%</strong><b>{money.format(recommendedPrice)}</b><p>{hasPrice(selectedRow.price) ? "Umbral calculado sobre el costo-to-serve estimado; no es una tarifa observada." : "Falta una tarifa pública capturada para comparar este umbral con el mercado."}</p></div>
        </aside>
      </div>

      <section className={styles.historyCard}>
        <div className={styles.cardHead}><div><span>EVOLUTIVO REAL</span><h3>Evolución de precios observados disponibles</h3></div><small>Une solo fechas con medición; no inventa meses intermedios</small></div>
        {chart ? <div className={styles.chartWrap}>
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Evolución observada de precios por operador">
            {[0, 1, 2, 3].map((index) => {
              const value = chart.max - index * (chart.max - chart.min) / 3;
              const y = chart.y(value);
              return <g key={index}><line x1={54} x2={742} y1={y} y2={y}/><text x={46} y={y + 4} textAnchor="end">{Math.round(value / 100) / 10}k</text></g>;
            })}
            {chartDates.map((date, index) => <text key={date} x={chart.x(index)} y={218} textAnchor="middle" className={styles.axisLabel}>{shortAxisDate(date)}</text>)}
            {chartSeries.map((series, rowIndex) => {
              const available = series.points.map((point, index) => ({ ...point, index })).filter((point): point is typeof point & { price: number } => hasPrice(point.price));
              const path = available.map((point, index) => `${index ? "L" : "M"}${chart.x(point.index).toFixed(1)},${chart.y(point.price).toFixed(1)}`).join(" ");
              return <g key={series.competitor} className={styles[`series${rowIndex}`]}>{path ? <path d={path}/> : null}{available.map((point) => <circle key={point.date} cx={chart.x(point.index)} cy={chart.y(point.price)} r={3.5}/>)}</g>;
            })}
          </svg>
          <div className={styles.legend}>{rows.map((row, index) => <span key={row.competitor}><i className={styles[`legend${index}`]}/>{row.competitor}</span>)}</div>
        </div> : <div className={styles.recommendation}><strong>Sin histórico suficiente para esta combinación.</strong><p>La pantalla mantendrá el precio actual y agregará puntos automáticamente a medida que las próximas corridas capturen nuevas observaciones.</p></div>}
      </section>

      <section className={styles.tableCard}>
        <div className={styles.cardHead}><div><span>COMPETITIVE VIEW</span><h3>Resumen comparable</h3></div><small>Precios reales/observados; rentabilidad estimada</small></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Operador</th><th>Precio observado</th><th>Fecha</th><th>Producto / SLA</th><th>Costo estimado</th><th>Contribución est.</th><th>Margen est.</th><th>Lectura</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.competitor}><td><b>{row.competitor}</b></td><td>{row.price ? money.format(row.price) : "—"}</td><td>{shortDate(row.observedAt)}</td><td>{row.product || "Sin equivalente público capturado"}</td><td>{money.format(row.cost)}</td><td>{row.contribution != null ? money.format(row.contribution) : "—"}</td><td><strong>{row.margin != null ? `${percent.format(row.margin)}%` : "—"}</strong></td><td>{row.price == null ? "Sin tarifa comparable" : row.margin != null && row.margin >= 30 ? "Rentabilidad estimada saludable" : row.margin != null && row.margin >= 20 ? "Competitivo / defendible" : "Margen estimado tensionado"}</td></tr>)}
        </tbody></table></div>
      </section>

      <footer className={styles.footnote}><b>Metodología:</b> precio = tarifa pública capturada u oficial para Santiago Centro → {route.destination}, {weight} kg, domicilio, Estándar. Costos = pickup + sort + linehaul + last mile + overhead bajo supuestos del modelo. Si un courier no tiene una tarifa pública capturada para esa combinación, se muestra vacío y no se estima un precio. La referencia de CorreosChile Estándar proviene de la Res. Exenta 66 publicada el 01-10-2025.</footer>
    </> : null}
  </article>;
}
