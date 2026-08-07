import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/UnifiedPlatformApp.tsx";
let text = readFileSync(path, "utf8");

const replacements = [
  {
    label: "TrendPayload",
    old: 'type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; error?: string };',
    next: 'type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; scopeLabel?: string; mode?: string; autoSelected?: boolean; error?: string };',
  },
  {
    label: "trend effect",
    old: `  const seriesKey = activeSeries.join("|");
  useEffect(() => {
    if (!activeSeries.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(filters.period), live: String(Date.now()) });
    activeSeries.forEach((series) => params.append("series", series));
    fetch(\`/api/daily-pricing-trend?\${params.toString()}\`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json() as TrendPayload; if (!response.ok) throw new Error(data.error || "No fue posible cargar la tendencia"); setTrend(data); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setNotice(error instanceof Error ? error.message : "Error cargando la tendencia"); });
    return () => controller.abort();
  }, [filters.period, seriesKey]);`,
    next: `  const seriesKey = activeSeries.join("|");
  useEffect(() => {
    if (view !== "overview" && view !== "movements") return;
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(filters.period), live: String(Date.now()) });
    let endpoint = "/api/contextual-pricing-trend";

    if (view === "movements") {
      if (!activeSeries.length) return;
      endpoint = "/api/daily-pricing-trend";
      activeSeries.forEach((series) => params.append("series", series));
    } else {
      if (filters.retailerType !== "all") params.set("retailerType", filters.retailerType);
      if (filters.supermarket) params.set("supermarket", filters.supermarket);
      if (filters.category) params.set("category", filters.category);
      if (filters.brand) params.set("brand", filters.brand);
      if (filters.stock !== "all") params.set("stock", filters.stock);
    }

    fetch(\`\${endpoint}?\${params.toString()}\`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json() as TrendPayload; if (!response.ok) throw new Error(data.error || "No fue posible cargar la tendencia"); setTrend(data); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setNotice(error instanceof Error ? error.message : "Error cargando la tendencia"); });
    return () => controller.abort();
  }, [view, filters.period, filters.retailerType, filters.supermarket, filters.category, filters.brand, filters.stock, seriesKey]);`,
  },
  {
    label: "overview card",
    old: '<article className={`${styles.card} ${styles.overviewTrend}`}><CardHead title="Evolución de precios promedio" subtitle="Índice base 100 por categoría y marca" action="Configurar series" onAction={() => navigate("movements")}/>{renderTrend()}</article>',
    next: '<article className={`${styles.card} ${styles.overviewTrend}`}><CardHead title="Evolución de precios promedio" subtitle={trend?.scopeLabel || "Selección automática según los filtros · índice base 100"} action="Ver detalle" onAction={() => navigate("movements")}/>{renderTrend()}</article>',
  },
];

let changed = false;
for (const { label, old, next } of replacements) {
  if (text.includes(next)) continue;
  if (!text.includes(old)) throw new Error(`No se encontró el bloque esperado: ${label}`);
  text = text.replace(old, next);
  changed = true;
}

if (changed) writeFileSync(path, text);
console.log(changed ? "Contextual trend UI aplicado" : "Contextual trend UI ya aplicado");
