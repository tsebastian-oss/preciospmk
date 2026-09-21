"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./PiwenMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

export type PiwenExecutivePosition = {
  family: string;
  product: string;
  format: string;
  piwenPrice: number;
  piwenPricePerKg: number | null;
  marketMedianPerKg: number | null;
  priceIndex: number | null;
  marketSkuCount: number;
  marketBrands: number;
  benchmarkQuality: "robust" | "limited" | "insufficient";
  benchmarkNote: string;
};

export type PiwenExecutiveListing = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  family: string;
  currentPrice: number;
  regularPrice: number | null;
  promotionPct: number | null;
  observedAt: string | null;
};

type HistoryPoint = {
  date: string;
  brand: string;
  family: string;
  pricePerKg: number;
  skuCount: number;
  retailers: number;
};

type HistoryPayload = {
  from: string | null;
  to: string | null;
  points: HistoryPoint[];
  error?: string;
};

type Opportunity = {
  key: string;
  family: string;
  product: string;
  priority: "Alta" | "Media";
  title: string;
  rationale: string;
  currentIndex: number;
  targetIndex: number;
  targetPrice: number;
  deltaPct: number;
  quality: "robust" | "limited";
};

type Movement = {
  key: string;
  brand: string;
  family: string;
  latestDate: string;
  previousDate: string;
  latest: number;
  previous: number;
  changePct: number;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CL");

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundPrice(value: number) {
  return Math.max(100, Math.round(value / 100) * 100);
}

function pct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function indexLabel(index: number | null) {
  if (index == null || !Number.isFinite(index)) return "Sin benchmark";
  if (index > 105) return "Premium";
  if (index < 95) return "Value";
  return "Paridad";
}

function directCompetitor(brand: string) {
  const value = brand.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return value.includes("alto la cruz") || value.includes("millantu");
}

function buildOpportunities(positions: PiwenExecutivePosition[]) {
  const rows: Opportunity[] = [];
  for (const position of positions) {
    if (
      position.benchmarkQuality === "insufficient"
      || position.priceIndex == null
      || !position.piwenPrice
      || !position.marketMedianPerKg
    ) continue;

    const index = position.priceIndex;
    let targetIndex: number | null = null;
    let title = "";
    let rationale = "";
    let priority: "Alta" | "Media" = "Media";

    if (index > 110) {
      targetIndex = 103;
      priority = index >= 115 ? "Alta" : "Media";
      title = "Revisar premium";
      rationale = `Piwén está ${(index - 100).toFixed(1)}% sobre el benchmark comparable. El escenario sugerido aproxima el índice a 103.`;
    } else if (index > 105) {
      targetIndex = 103;
      title = "Premium moderado";
      rationale = `El índice está por encima de la banda de paridad. Conviene validar elasticidad antes de sostener este premium.`;
    } else if (index < 90) {
      targetIndex = 95;
      priority = index <= 85 ? "Alta" : "Media";
      title = "Espacio para capturar valor";
      rationale = `Piwén está ${(100 - index).toFixed(1)}% bajo el benchmark. Existe espacio de precio antes de entrar a la banda de paridad.`;
    } else if (index < 95) {
      targetIndex = 98;
      title = "Precio bajo mercado";
      rationale = "El producto se mantiene bajo la referencia comparable. El escenario acerca el índice a 98.";
    }

    if (targetIndex == null) continue;
    const targetPrice = roundPrice(position.piwenPrice * targetIndex / index);
    const deltaPct = (targetPrice / position.piwenPrice - 1) * 100;
    rows.push({
      key: position.product,
      family: position.family,
      product: position.product,
      priority,
      title,
      rationale,
      currentIndex: index,
      targetIndex,
      targetPrice,
      deltaPct,
      quality: position.benchmarkQuality,
    });
  }

  return rows.sort((a,b) => {
    if (a.priority !== b.priority) return a.priority === "Alta" ? -1 : 1;
    return Math.abs(b.currentIndex - 100) - Math.abs(a.currentIndex - 100);
  });
}

function buildMovements(points: HistoryPoint[]) {
  const groups = new Map<string, HistoryPoint[]>();
  for (const point of points) {
    if (!point.date || !point.brand || !point.family || !Number.isFinite(Number(point.pricePerKg)) || Number(point.pricePerKg) <= 0) continue;
    const key = `${point.brand}::${point.family}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...point, pricePerKg: Number(point.pricePerKg) }]);
  }

  const movements: Movement[] = [];
  for (const [key, rows] of groups.entries()) {
    const ordered = [...rows].sort((a,b)=>a.date.localeCompare(b.date));
    if (ordered.length < 2) continue;
    const latest = ordered[ordered.length - 1];
    let previous: HistoryPoint | undefined;
    for (let index = ordered.length - 2; index >= 0; index -= 1) {
      if (ordered[index].date !== latest.date) {
        previous = ordered[index];
        break;
      }
    }
    if (!previous || previous.pricePerKg <= 0) continue;
    const changePct = (latest.pricePerKg / previous.pricePerKg - 1) * 100;
    movements.push({
      key,
      brand: latest.brand,
      family: latest.family,
      latestDate: latest.date,
      previousDate: previous.date,
      latest: latest.pricePerKg,
      previous: previous.pricePerKg,
      changePct,
    });
  }

  return movements.sort((a,b)=>Math.abs(b.changePct)-Math.abs(a.changePct));
}

export default function PiwenExecutiveIntelligence({
  positions,
  listings,
  mode = "summary",
}: {
  positions: PiwenExecutivePosition[];
  listings: PiwenExecutiveListing[];
  mode?: "summary" | "full";
}) {
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyError, setHistoryError] = useState("");
  const selectable = useMemo(
    () => positions.filter(position =>
      position.priceIndex != null
      && position.piwenPrice > 0
      && position.piwenPricePerKg != null
      && position.marketMedianPerKg != null
      && position.benchmarkQuality !== "insufficient"
    ),
    [positions],
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [simulatedPrice, setSimulatedPrice] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/brands/piwen/history", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as HistoryPayload;
        if (!response.ok) throw new Error(data.error || "No fue posible cargar movimientos.");
        if (active) setHistory(data);
      })
      .catch(cause => {
        if (active) setHistoryError(cause instanceof Error ? cause.message : "Histórico no disponible.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectable.length) return;
    const next = selectable.find(position => position.product === selectedKey) ?? selectable[0];
    if (next.product !== selectedKey) setSelectedKey(next.product);
    setSimulatedPrice(next.piwenPrice);
  }, [selectable, selectedKey]);

  const opportunities = useMemo(() => buildOpportunities(positions), [positions]);
  const movements = useMemo(() => buildMovements(history?.points ?? []), [history]);
  const relevantMovements = useMemo(() => movements.filter(row => Math.abs(row.changePct) >= 5), [movements]);
  const robustIndexes = positions
    .filter(position => position.benchmarkQuality === "robust" && position.priceIndex != null)
    .map(position => Number(position.priceIndex));
  const validIndexes = positions.filter(position => position.priceIndex != null).map(position => Number(position.priceIndex));
  const marketIndex = median(robustIndexes.length ? robustIndexes : validIndexes);
  const robustPct = positions.length
    ? Math.round(positions.filter(position => position.benchmarkQuality === "robust").length / positions.length * 100)
    : 0;
  const coveredPct = positions.length
    ? Math.round(positions.filter(position => position.benchmarkQuality !== "insufficient").length / positions.length * 100)
    : 0;

  const directPromotions = useMemo(
    () => listings
      .filter(row => directCompetitor(row.brand) && (row.promotionPct ?? 0) >= 5)
      .sort((a,b)=>(b.promotionPct ?? 0)-(a.promotionPct ?? 0)),
    [listings],
  );

  const alerts = useMemo(() => {
    const rows: Array<{ key: string; level: "high" | "medium" | "info"; title: string; text: string }> = [];
    relevantMovements.slice(0,5).forEach(movement => {
      rows.push({
        key: "movement-" + movement.key,
        level: Math.abs(movement.changePct) >= 10 ? "high" : "medium",
        title: `${movement.brand} · ${movement.family}`,
        text: `$/kg ${pct(movement.changePct)} entre ${movement.previousDate} y ${movement.latestDate}.`,
      });
    });
    if (directPromotions.length) {
      const maxPromo = directPromotions[0];
      rows.push({
        key: "direct-promos",
        level: (maxPromo.promotionPct ?? 0) >= 15 ? "high" : "medium",
        title: "Competidores directos en promoción",
        text: `${directPromotions.length} SKU de Alto La Cruz/Millantú muestran descuento; máximo observado ${(maxPromo.promotionPct ?? 0).toFixed(1)}%.`,
      });
    }
    const insufficient = positions.filter(position => position.benchmarkQuality === "insufficient");
    if (insufficient.length) {
      rows.push({
        key: "coverage-gap",
        level: "info",
        title: "Brecha de benchmark",
        text: `${insufficient.length} producto(s) Piwén no tienen muestra comparable suficiente para calcular índice.`,
      });
    }
    return rows;
  }, [relevantMovements, directPromotions, positions]);

  const selected = selectable.find(position => position.product === selectedKey) ?? selectable[0] ?? null;
  const simulatedKg = selected && selected.piwenPricePerKg
    ? selected.piwenPricePerKg * simulatedPrice / selected.piwenPrice
    : null;
  const simulatedIndex = selected && simulatedKg && selected.marketMedianPerKg
    ? simulatedKg / selected.marketMedianPerKg * 100
    : null;
  const selectedIndex = selected?.priceIndex ?? null;
  const parityPrice = selected && selectedIndex != null
    ? roundPrice(selected.piwenPrice * 100 / selectedIndex)
    : null;
  const minPrice = selected ? roundPrice(selected.piwenPrice * 0.75) : 0;
  const maxPrice = selected ? roundPrice(selected.piwenPrice * 1.25) : 0;

  const kpis = <div className={styles.execKpis}>
    <article>
      <span>ÍNDICE PIWÉN</span>
      <strong>{marketIndex == null ? "N/D" : marketIndex.toFixed(1)}</strong>
      <small>mediana de benchmarks válidos · 100 = paridad</small>
    </article>
    <article>
      <span>OPORTUNIDADES</span>
      <strong>{opportunities.length}</strong>
      <small>desvíos accionables de la banda 95–105</small>
    </article>
    <article>
      <span>MOVIMIENTOS</span>
      <strong>{relevantMovements.length}</strong>
      <small>variaciones ≥5% en la última observación disponible</small>
    </article>
    <article>
      <span>CALIDAD DE DATO</span>
      <strong>{robustPct}%</strong>
      <small>{coveredPct}% con benchmark utilizable</small>
    </article>
  </div>;

  if (mode === "summary") {
    return <section className={styles.execShell}>
      <div className={styles.execHead}>
        <div><span>EXECUTIVE PRICING WATCH</span><h2>Qué requiere atención ahora</h2><p>Reglas automáticas sobre benchmarks comparables e histórico Supabase. Sin IA ni supuestos manuales.</p></div>
        <small>{history?.to ? `Histórico actualizado al ${history.to}` : historyError || "Cargando histórico…"}</small>
      </div>
      {kpis}
      <div className={styles.alertStrip}>
        {(alerts.length ? alerts.slice(0,4) : [{ key:"stable", level:"info" as const, title:"Sin alertas críticas", text:"No se detectan movimientos ≥5% ni brechas críticas adicionales con la muestra disponible." }]).map(alert =>
          <div key={alert.key} className={alert.level === "high" ? styles.alertHigh : alert.level === "medium" ? styles.alertMedium : styles.alertInfo}>
            <strong>{alert.title}</strong><span>{alert.text}</span>
          </div>
        )}
      </div>
    </section>;
  }

  return <section className={styles.execShell}>
    <div className={styles.execHead}>
      <div>
        <span>OPORTUNIDADES DE PRICING</span>
        <h2>Prioridades, alertas y simulación</h2>
        <p>Las oportunidades se generan con reglas transparentes: premium &gt;105, value &lt;95, benchmark comparable y movimientos históricos observados.</p>
      </div>
      <small>{history?.from && history?.to ? `${history.from} → ${history.to}` : historyError || "Cargando histórico…"}</small>
    </div>

    {kpis}

    <div className={styles.execGrid}>
      <article className={styles.execCard}>
        <div className={styles.execCardTitle}><span>PRIORIDADES</span><h3>Oportunidades detectadas</h3></div>
        <div className={styles.opportunityList}>
          {opportunities.length ? opportunities.map(opportunity => <div key={opportunity.key} className={styles.opportunityRow}>
            <div className={styles.priorityBadge} data-priority={opportunity.priority.toLowerCase()}>{opportunity.priority}</div>
            <div>
              <strong>{opportunity.family}</strong>
              <span>{opportunity.product}</span>
              <small>{opportunity.rationale} · {opportunity.quality === "robust" ? "benchmark robusto" : "muestra limitada"}</small>
            </div>
            <div className={styles.opportunityNumbers}>
              <span>Índice {opportunity.currentIndex.toFixed(1)} → {opportunity.targetIndex}</span>
              <strong>{money.format(opportunity.targetPrice)}</strong>
              <small>{pct(opportunity.deltaPct)} vs precio actual</small>
            </div>
          </div>) : <div className={styles.execEmpty}>Los productos con benchmark válido están dentro de la banda 95–105.</div>}
        </div>
      </article>

      <article className={styles.execCard}>
        <div className={styles.execCardTitle}><span>MARKET WATCH</span><h3>Cambios y alertas</h3></div>
        <div className={styles.marketWatchList}>
          {(alerts.length ? alerts : [{ key:"stable", level:"info" as const, title:"Mercado estable", text:"No hay alertas relevantes con las últimas observaciones disponibles." }]).map(alert =>
            <div key={alert.key} className={alert.level === "high" ? styles.watchHigh : alert.level === "medium" ? styles.watchMedium : styles.watchInfo}>
              <i/>
              <div><strong>{alert.title}</strong><span>{alert.text}</span></div>
            </div>
          )}
        </div>
        <div className={styles.dataQuality}>
          <div><span>Benchmarks robustos</span><strong>{positions.filter(position=>position.benchmarkQuality === "robust").length}/{positions.length}</strong></div>
          <div><span>SKU competitivos</span><strong>{integer.format(listings.length)}</strong></div>
          <div><span>Promos directas</span><strong>{directPromotions.length}</strong></div>
        </div>
      </article>
    </div>

    <article className={styles.simulatorCard}>
      <div className={styles.simulatorHead}>
        <div><span>SIMULADOR DE POSICIONAMIENTO</span><h3>¿Qué pasa si cambio el precio?</h3><p>Recalcula $/kg e índice competitivo manteniendo el mismo benchmark comparable.</p></div>
        {selected && <label>
          <span>PRODUCTO PIWÉN</span>
          <select value={selectedKey} onChange={event => {
            setSelectedKey(event.target.value);
            trackUsageEvent("filter_change", { module:"piwen-opportunities", metadata:{ filter:"simulator-product", value:event.target.value } });
          }}>
            {selectable.map(position => <option key={position.product} value={position.product}>{position.family} · {position.format}</option>)}
          </select>
        </label>}
      </div>

      {!selected ? <div className={styles.execEmpty}>No hay productos con benchmark suficiente para simular.</div> : <>
        <div className={styles.simulatorGrid}>
          <div className={styles.simulatorControl}>
            <span>Precio simulado</span>
            <strong>{money.format(simulatedPrice)}</strong>
            <input
              type="range"
              min={minPrice}
              max={maxPrice}
              step={100}
              value={simulatedPrice}
              onChange={event => setSimulatedPrice(Number(event.target.value))}
            />
            <div><small>{money.format(minPrice)}</small><small>{money.format(maxPrice)}</small></div>
          </div>
          <div className={styles.simMetric}><span>Precio actual</span><strong>{money.format(selected.piwenPrice)}</strong><small>{selected.piwenPricePerKg ? money.format(selected.piwenPricePerKg) + "/kg" : "sin $/kg"}</small></div>
          <div className={styles.simMetric}><span>Benchmark</span><strong>{selected.marketMedianPerKg ? money.format(selected.marketMedianPerKg) + "/kg" : "N/D"}</strong><small>{selected.marketBrands} marca(s) · {selected.marketSkuCount} SKU</small></div>
          <div className={styles.simMetric}><span>Índice simulado</span><strong>{simulatedIndex == null ? "N/D" : simulatedIndex.toFixed(1)}</strong><small>{indexLabel(simulatedIndex)}</small></div>
        </div>
        <div className={styles.simulatorActions}>
          <button onClick={()=>setSimulatedPrice(selected.piwenPrice)}>Precio actual</button>
          {parityPrice && <button onClick={()=>setSimulatedPrice(parityPrice)}>Paridad 100 · {money.format(parityPrice)}</button>}
          {selectedIndex != null && <button onClick={()=>setSimulatedPrice(roundPrice(selected.piwenPrice * 95 / selectedIndex))}>Índice 95</button>}
          {selectedIndex != null && <button onClick={()=>setSimulatedPrice(roundPrice(selected.piwenPrice * 105 / selectedIndex))}>Índice 105</button>}
        </div>
        <div className={styles.simulatorReadout}>
          <strong>{simulatedPrice === selected.piwenPrice ? "Escenario actual" : simulatedPrice > selected.piwenPrice ? "Escenario de aumento" : "Escenario de reducción"}</strong>
          <span>
            {simulatedPrice === selected.piwenPrice
              ? `Piwén se mantiene en índice ${selected.priceIndex?.toFixed(1) ?? "N/D"}.`
              : `Cambio de ${pct((simulatedPrice / selected.piwenPrice - 1) * 100)} en precio → índice estimado ${simulatedIndex?.toFixed(1) ?? "N/D"} (${indexLabel(simulatedIndex)}).`}
          </span>
        </div>
      </>}
    </article>
  </section>;
}
