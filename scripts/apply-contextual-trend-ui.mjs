import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/UnifiedPlatformApp.tsx";
let text = readFileSync(path, "utf8");
let changed = false;

function replaceOnce(label, oldValue, newValue) {
  if (text.includes(newValue)) return;
  if (!text.includes(oldValue)) throw new Error(`No se encontró el bloque esperado: ${label}`);
  text = text.replace(oldValue, newValue);
  changed = true;
}

// ---- Contextual pricing trend ------------------------------------------------
const contextualReplacements = [
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

for (const { label, old, next } of contextualReplacements) replaceOnce(label, old, next);

// ---- Brand Intelligence AI ---------------------------------------------------
replaceOnce(
  "BrandIntelligenceChat import",
  'import styles from "./UnifiedPlatformApp.module.css";',
  'import styles from "./UnifiedPlatformApp.module.css";\nimport BrandIntelligenceChat from "./BrandIntelligenceChat";',
);

if (text.includes(' | "competitive"')) {
  text = text.replace(' | "competitive"', ' | "brand-ai"');
  changed = true;
}
if (text.includes(' | "basket"')) {
  text = text.replace(' | "basket"', '');
  changed = true;
}

replaceOnce(
  "Brand Intelligence menu",
  '{ view: "competitive", label: "Competitive AI", icon: "✦" },',
  '{ view: "brand-ai", label: "Brand Intelligence AI", icon: "✦" },',
);

if (text.includes('    { view: "basket", label: "Basket Simulator", icon: "▤" },\n')) {
  text = text.replace('    { view: "basket", label: "Basket Simulator", icon: "▤" },\n', '');
  changed = true;
}

replaceOnce(
  "Brand Intelligence copy",
  '  competitive: { title: "Competitive AI", description: "Analiza posición de precio, riesgo competitivo y acciones sugeridas por producto." },',
  '  "brand-ai": { title: "Brand Intelligence AI", description: "Conversa con tus datos de marca y obtén análisis de precios, surtido, stock y promociones con OpenAI." },',
);

if (text.includes('  basket: { title: "Basket Simulator", description: "Compara el costo de una canasta homologada entre supermercados." },\n')) {
  text = text.replace('  basket: { title: "Basket Simulator", description: "Compara el costo de una canasta homologada entre supermercados." },\n', '');
  changed = true;
}

if (text.includes('  const [basketKeys, setBasketKeys] = useState<string[]>([]);\n')) {
  text = text.replace('  const [basketKeys, setBasketKeys] = useState<string[]>([]);\n', '');
  changed = true;
}
if (text.includes('  const basketMatches = matches.matches.filter((item) => basketKeys.includes(item.match_key));\n')) {
  text = text.replace('  const basketMatches = matches.matches.filter((item) => basketKeys.includes(item.match_key));\n', '');
  changed = true;
}

const competitiveLoadMatches = `  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    const competitiveMode = view === "competitive";
    const params = new URLSearchParams({
      page: competitiveMode ? "1" : String(matchPage),
      pageSize: competitiveMode ? "1000" : "30",
      sort: competitiveMode ? "name_asc" : matchSort,
      minSavings: competitiveMode ? "0" : minSavings,
    });`;
const normalLoadMatches = `  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    const params = new URLSearchParams({ page: String(matchPage), pageSize: "30", sort: matchSort, minSavings });`;
if (text.includes(competitiveLoadMatches)) {
  text = text.replace(competitiveLoadMatches, normalLoadMatches);
  changed = true;
}
if (text.includes('  }, [filters.query, filters.category, filters.brand, matchPage, matchSort, minSavings, view]);')) {
  text = text.replace(
    '  }, [filters.query, filters.category, filters.brand, matchPage, matchSort, minSavings, view]);',
    '  }, [filters.query, filters.category, filters.brand, matchPage, matchSort, minSavings]);',
  );
  changed = true;
}

if (!text.includes('if (view === "brand-ai") return <BrandIntelligenceChat filters={filters}/>;')) {
  const start = text.indexOf('    if (view === "competitive") {');
  const end = text.indexOf('    if (view === "optimizer") {', start);
  if (start < 0 || end < 0) throw new Error('No se encontró el renderer de Competitive AI');
  text = text.slice(0, start) + '    if (view === "brand-ai") return <BrandIntelligenceChat filters={filters}/>;\n\n' + text.slice(end);
  changed = true;
}

if (text.includes('    if (view === "basket") {')) {
  const start = text.indexOf('    if (view === "basket") {');
  const end = text.indexOf('    if (view === "categories") {', start);
  if (end < 0) throw new Error('No se encontró el final del renderer de Basket Simulator');
  text = text.slice(0, start) + text.slice(end);
  changed = true;
}

const oldShortcut = '<QuickAction title="IA / Insights" copy="Prioriza brechas, alzas y oportunidades." button="Abrir Competitive AI" onClick={() => navigate("competitive")}/>';
const newShortcut = '<QuickAction title="Brand Intelligence AI" copy="Pregunta por cualquier marca usando datos reales de la plataforma." button="Abrir chat" onClick={() => navigate("brand-ai")}/>';
if (!text.includes(newShortcut)) {
  if (!text.includes(oldShortcut)) throw new Error('No se encontró el acceso rápido de Competitive AI');
  text = text.replace(oldShortcut, newShortcut);
  changed = true;
}

if (text.includes('Competitive AI') || text.includes('Basket Simulator') || text.includes('view === "competitive"') || text.includes('view === "basket"')) {
  throw new Error('Quedaron referencias visibles a módulos legacy');
}

if (changed) writeFileSync(path, text);
console.log(changed ? "Brand Intelligence AI y tendencia contextual aplicados" : "Prebuild ya aplicado");
