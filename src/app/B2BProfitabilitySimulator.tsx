"use client";

import { useMemo, useState } from "react";
import styles from "./B2BProfitabilitySimulator.module.css";

type CompetitorName = "Chilexpress" | "Starken" | "Blue Express" | "CorreosChile";
type ServiceLevel = "Económico" | "Estándar" | "Express";
type CostScenario = "Eficiente" | "Base" | "Exigente";

type CompetitorProfile = {
  name: CompetitorName;
  priceIndex: number;
  pickup: number;
  sort: number;
  linehaulFactor: number;
  lastMile: number;
  overhead: number;
  density: number;
};

type SimulationRow = {
  competitor: CompetitorName;
  price: number;
  cost: number;
  contribution: number;
  margin: number;
  priceIndex: number;
  density: number;
  history: number[];
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });

const COMPETITORS: CompetitorProfile[] = [
  { name: "Chilexpress", priceIndex: 1.00, pickup: 650, sort: 610, linehaulFactor: 1.00, lastMile: 1540, overhead: 720, density: 92 },
  { name: "Starken", priceIndex: 0.93, pickup: 610, sort: 590, linehaulFactor: 0.98, lastMile: 1510, overhead: 650, density: 84 },
  { name: "Blue Express", priceIndex: 0.88, pickup: 570, sort: 520, linehaulFactor: 0.94, lastMile: 1320, overhead: 610, density: 108 },
  { name: "CorreosChile", priceIndex: 0.84, pickup: 600, sort: 640, linehaulFactor: 1.03, lastMile: 1610, overhead: 690, density: 77 },
];

const ROUTES = [
  { key: "Santiago|Valparaíso", origin: "Santiago", destination: "Valparaíso", km: 120, basePrice: 5050 },
  { key: "Santiago|Concepción", origin: "Santiago", destination: "Concepción", km: 500, basePrice: 6800 },
  { key: "Santiago|Temuco", origin: "Santiago", destination: "Temuco", km: 690, basePrice: 7350 },
  { key: "Santiago|Antofagasta", origin: "Santiago", destination: "Antofagasta", km: 1340, basePrice: 9100 },
  { key: "Santiago|Puerto Montt", origin: "Santiago", destination: "Puerto Montt", km: 1030, basePrice: 8450 },
];

const WEIGHTS = [1, 3, 5, 10, 20];
const MONTHS = ["Mar", "Abr", "May", "Jun", "Jul", "Ago"];
const SERVICE_MULTIPLIER: Record<ServiceLevel, number> = { Económico: 0.90, Estándar: 1, Express: 1.18 };
const COST_SCENARIO_MULTIPLIER: Record<CostScenario, number> = { Eficiente: 0.91, Base: 1, Exigente: 1.12 };
const HISTORY_FACTORS: Record<CompetitorName, number[]> = {
  Chilexpress: [0.94, 0.96, 0.97, 0.99, 1.00, 1.00],
  Starken: [0.97, 0.96, 0.95, 0.94, 0.94, 0.93],
  "Blue Express": [0.92, 0.91, 0.90, 0.89, 0.88, 0.88],
  CorreosChile: [0.89, 0.88, 0.87, 0.86, 0.85, 0.84],
};

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

export default function B2BProfitabilitySimulator() {
  const [routeKey, setRouteKey] = useState("Santiago|Concepción");
  const [weight, setWeight] = useState(5);
  const [service, setService] = useState<ServiceLevel>("Estándar");
  const [scenario, setScenario] = useState<CostScenario>("Base");
  const [selected, setSelected] = useState<CompetitorName>("Chilexpress");
  const [priceAdjustment, setPriceAdjustment] = useState(0);

  const route = ROUTES.find((item) => item.key === routeKey) ?? ROUTES[1];

  const rows = useMemo<SimulationRow[]>(() => {
    const weightFactor = 1 + Math.log2(Math.max(1, weight)) * 0.10;
    const serviceFactor = SERVICE_MULTIPLIER[service];
    const scenarioFactor = COST_SCENARIO_MULTIPLIER[scenario];

    return COMPETITORS.map((profile) => {
      const adjustment = profile.name === selected ? 1 + priceAdjustment / 100 : 1;
      const price = route.basePrice * weightFactor * serviceFactor * profile.priceIndex * adjustment;
      const linehaul = (route.km * 2.15 + 380) * profile.linehaulFactor * (1 + (weight - 1) * 0.018);
      const densityEfficiency = clamp(92 / profile.density, 0.78, 1.24);
      const lastMile = profile.lastMile * densityEfficiency;
      const cost = (profile.pickup + profile.sort + linehaul + lastMile + profile.overhead) * scenarioFactor;
      const contribution = price - cost;
      const margin = price > 0 ? contribution / price * 100 : 0;
      const history = HISTORY_FACTORS[profile.name].map((factor) => route.basePrice * weightFactor * serviceFactor * factor);
      return { competitor: profile.name, price, cost, contribution, margin, priceIndex: profile.priceIndex * 100, density: profile.density, history };
    });
  }, [route, weight, service, scenario, selected, priceAdjustment]);

  const selectedRow = rows.find((row) => row.competitor === selected) ?? rows[0];
  const marketPrice = rows.reduce((sum, row) => sum + row.price, 0) / rows.length;
  const bestMargin = [...rows].sort((a, b) => b.margin - a.margin)[0];
  const lowestPrice = [...rows].sort((a, b) => a.price - b.price)[0];
  const recommendedPrice = selectedRow.cost / 0.72;

  const chart = useMemo(() => {
    const all = rows.flatMap((row) => row.history);
    const min = Math.min(...all) * 0.96;
    const max = Math.max(...all) * 1.04;
    const width = 760;
    const height = 230;
    const left = 54;
    const right = 18;
    const top = 18;
    const bottom = 34;
    const x = (index: number) => left + index * ((width - left - right) / (MONTHS.length - 1));
    const y = (value: number) => top + (max - value) / Math.max(1, max - min) * (height - top - bottom);
    const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
    return { width, height, min, max, x, y, path };
  }, [rows]);

  return <article className={styles.shell}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>COMPETITIVE PROFITABILITY · DEMO</span>
        <h2>Simulador de rentabilidad competitiva</h2>
        <p>Transforma precios observados en una estimación de costo-to-serve, contribución y margen probable por operador, ruta y peso.</p>
      </div>
      <div className={styles.demoBadge}>DATOS SIMULADOS</div>
    </header>

    <div className={styles.controls}>
      <label>Ruta<select value={routeKey} onChange={(event) => setRouteKey(event.target.value)}>{ROUTES.map((item) => <option key={item.key} value={item.key}>{item.origin} → {item.destination}</option>)}</select></label>
      <label>Peso<select value={weight} onChange={(event) => setWeight(Number(event.target.value))}>{WEIGHTS.map((value) => <option key={value} value={value}>{value} kg</option>)}</select></label>
      <label>Servicio<select value={service} onChange={(event) => setService(event.target.value as ServiceLevel)}><option>Económico</option><option>Estándar</option><option>Express</option></select></label>
      <label>Escenario costo<select value={scenario} onChange={(event) => setScenario(event.target.value as CostScenario)}><option>Eficiente</option><option>Base</option><option>Exigente</option></select></label>
    </div>

    <div className={styles.kpis}>
      <div><span>Precio medio mercado</span><strong>{money.format(marketPrice)}</strong><small>{route.origin} → {route.destination}</small></div>
      <div><span>Operador más agresivo</span><strong>{lowestPrice.competitor}</strong><small>{money.format(lowestPrice.price)} por envío</small></div>
      <div><span>Mayor margen estimado</span><strong>{percent.format(bestMargin.margin)}%</strong><small>{bestMargin.competitor}</small></div>
      <div><span>Distancia de referencia</span><strong>{route.km.toLocaleString("es-CL")} km</strong><small>{weight} kg · {service}</small></div>
    </div>

    <div className={styles.mainGrid}>
      <section className={styles.comparisonCard}>
        <div className={styles.cardHead}><div><span>ECONOMÍA UNITARIA ESTIMADA</span><h3>Precio, costo y margen por competidor</h3></div><small>CTE = pickup + sort + linehaul + last mile + overhead</small></div>
        <div className={styles.operatorGrid}>
          {rows.map((row) => <button type="button" key={row.competitor} className={selected === row.competitor ? styles.operatorActive : styles.operator} onClick={() => { setSelected(row.competitor); setPriceAdjustment(0); }}>
            <div className={styles.operatorTitle}><strong>{row.competitor}</strong><span>Índice {row.priceIndex.toFixed(0)}</span></div>
            <div className={styles.priceLine}><span>Precio</span><b>{money.format(row.price)}</b></div>
            <div className={styles.priceLine}><span>Costo estimado</span><b>{money.format(row.cost)}</b></div>
            <div className={styles.marginLine}><span>Margen estimado</span><strong className={row.margin >= 28 ? styles.good : row.margin >= 18 ? styles.mid : styles.risk}>{percent.format(row.margin)}%</strong></div>
            <div className={styles.marginTrack}><i style={{ width: `${clamp(row.margin, 0, 45) / 45 * 100}%` }}/></div>
          </button>)}
        </div>
      </section>

      <aside className={styles.scenarioCard}>
        <div className={styles.cardHead}><div><span>WHAT-IF</span><h3>{selected}</h3></div><small>Sensibilidad de precio</small></div>
        <div className={styles.sliderValue}><strong>{priceAdjustment > 0 ? "+" : ""}{priceAdjustment}%</strong><span>ajuste sobre tarifa demo</span></div>
        <input className={styles.range} type="range" min={-20} max={20} step={1} value={priceAdjustment} onChange={(event) => setPriceAdjustment(Number(event.target.value))}/>
        <div className={styles.scenarioStats}>
          <div><span>Nuevo precio</span><b>{money.format(selectedRow.price)}</b></div>
          <div><span>Contribución</span><b>{money.format(selectedRow.contribution)}</b></div>
          <div><span>Margen</span><b>{percent.format(selectedRow.margin)}%</b></div>
          <div><span>Densidad asumida</span><b>{selectedRow.density} ent./día</b></div>
        </div>
        <div className={styles.recommendation}><span>REFERENCIA</span><strong>Precio para margen 28%</strong><b>{money.format(recommendedPrice)}</b><p>{selectedRow.price >= recommendedPrice ? "La tarifa simulada está sobre el umbral de margen objetivo." : "Bajar más el precio tensionaría el margen bajo el 28% en este escenario."}</p></div>
      </aside>
    </div>

    <section className={styles.historyCard}>
      <div className={styles.cardHead}><div><span>EVOLUTIVO</span><h3>Precio estimado por envío · últimos 6 meses</h3></div><small>Misma ruta · mismo peso · mismo servicio</small></div>
      <div className={styles.chartWrap}>
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Evolución simulada de precios por operador">
          {[0, 1, 2, 3].map((index) => {
            const value = chart.max - index * (chart.max - chart.min) / 3;
            const y = chart.y(value);
            return <g key={index}><line x1={54} x2={742} y1={y} y2={y}/><text x={46} y={y + 4} textAnchor="end">{Math.round(value / 100) / 10}k</text></g>;
          })}
          {MONTHS.map((month, index) => <text key={month} x={chart.x(index)} y={218} textAnchor="middle" className={styles.axisLabel}>{month}</text>)}
          {rows.map((row, rowIndex) => <g key={row.competitor} className={styles[`series${rowIndex}`]}><path d={chart.path(row.history)}/>{row.history.map((value, index) => <circle key={index} cx={chart.x(index)} cy={chart.y(value)} r={3.5}/>)}</g>)}
        </svg>
        <div className={styles.legend}>{rows.map((row, index) => <span key={row.competitor}><i className={styles[`legend${index}`]}/>{row.competitor}</span>)}</div>
      </div>
    </section>

    <section className={styles.tableCard}>
      <div className={styles.cardHead}><div><span>COMPETITIVE VIEW</span><h3>Resumen comparable</h3></div><small>Rangos orientativos, no estados financieros reportados</small></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Operador</th><th>Precio</th><th>Costo estimado</th><th>Contribución</th><th>Margen estimado</th><th>Lectura</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.competitor}><td><b>{row.competitor}</b></td><td>{money.format(row.price)}</td><td>{money.format(row.cost)}</td><td>{money.format(row.contribution)}</td><td><strong>{percent.format(row.margin)}%</strong></td><td>{row.margin >= 30 ? "Rentabilidad saludable" : row.margin >= 20 ? "Competitivo / defendible" : row.margin >= 10 ? "Margen tensionado" : "Posible guerra de precios"}</td></tr>)}
      </tbody></table></div>
    </section>

    <footer className={styles.footnote}><b>Metodología demo:</b> costo estimado = pickup + sort + linehaul + last mile + overhead. La densidad de entregas modifica el costo de última milla. Los datos son simulados y sirven para demostrar cómo la herramienta puede conectarse posteriormente a costos reales de Chilexpress, precios censados, Mercado Público y variables operacionales.</footer>
  </article>;
}
