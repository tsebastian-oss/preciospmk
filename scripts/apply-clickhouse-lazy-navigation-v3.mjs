import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const cssPath = "src/app/UnifiedPlatformApp.module.css";
let source = fs.readFileSync(appPath, "utf8");

const styleImport = 'import styles from "./UnifiedPlatformApp.module.css";';
if (!source.includes('import ClickHouseLanding from "./ClickHouseLanding";')) {
  if (!source.includes(styleImport)) throw new Error("Lazy navigation: styles import missing");
  source = source.replace(styleImport, `${styleImport}\nimport ClickHouseLanding from "./ClickHouseLanding";\nimport ClickHouseInsightView, { type ClickHouseInsightMode } from "./ClickHouseInsightView";`);
}

const viewLine = source.match(/type View = ([^;]+);/);
if (!viewLine) throw new Error("Lazy navigation: View type missing");
const requiredViews = ["price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","products","data-status"];
let nextView = viewLine[0];
for (const view of requiredViews) {
  if (!nextView.includes(`"${view}"`)) nextView = nextView.replace(";", ` | "${view}";`);
}
source = source.replace(viewLine[0], nextView);

const menuRegex = /const MENU: MenuGroup\[] = \[[\s\S]*?\n\];\n\nconst COPY/;
if (!menuRegex.test(source)) throw new Error("Lazy navigation: MENU block missing");
const menu = `const MENU: MenuGroup[] = [
  { label: "Inicio", items: [
    { view: "overview", label: "Asistente & Inicio", icon: "✦" },
  ] },
  { label: "Análisis de precios", items: [
    { view: "price-evolution", label: "Evolución de precios", icon: "⌁" },
    { view: "retailer-benchmark", label: "Benchmark retailers", icon: "▥" },
    { view: "price-gaps", label: "Brechas de precio", icon: "⇄" },
    { view: "price-alerts", label: "Movimientos y alertas", icon: "!" },
  ] },
  { label: "Análisis de mercado", items: [
    { view: "market-coverage", label: "Cobertura de mercado", icon: "◫" },
    { view: "category-intelligence", label: "Análisis de categorías", icon: "◒" },
    { view: "products", label: "Productos", icon: "□" },
  ] },
  { label: "Datos y operación", items: [
    { view: "downloads", label: "Descarga de bases", icon: "↓" },
    { view: "data-status", label: "Estado de datos", icon: "↻" },
    { view: "settings", label: "Configuración", icon: "⚙" },
  ] },
];

const COPY`;
source = source.replace(menuRegex, menu);

const copyAnchor = 'const COPY: Record<View, { title: string; description: string }> = {\n';
if (!source.includes(copyAnchor)) throw new Error("Lazy navigation: COPY anchor missing");
const copyEntries = `  "price-evolution": { title: "Evolución de precios", description: "Histórico de precios por marca, producto y retailer desde ClickHouse." },
  "retailer-benchmark": { title: "Benchmark retailers", description: "Compara mediana y rango de precios entre retailers." },
  "market-coverage": { title: "Cobertura de mercado", description: "Profundidad y disponibilidad del catálogo monitoreado." },
  "price-gaps": { title: "Brechas de precio", description: "Diferencias de precio entre retailers sobre universos comparables." },
  "price-alerts": { title: "Movimientos y alertas", description: "Alzas y bajas diarias detectadas en ClickHouse." },
  products: { title: "Productos", description: "Explora precios actuales por marca y producto directamente desde ClickHouse." },
  "data-status": { title: "Estado de datos", description: "Freshness y actividad de las fuentes monitoreadas." },
`;
if (!source.includes('"price-evolution": { title:')) source = source.replace(copyAnchor, copyAnchor + copyEntries);

const defaultFiltersAnchor = 'const DEFAULT_FILTERS:';
const helper = `const CLICKHOUSE_INSIGHT_VIEWS = new Set<View>(["price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","products","data-status"]);
const LAZY_VISIBLE_VIEWS = new Set<View>(["overview","price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","category-intelligence","products","downloads","data-status","settings"]);
const DARK_VISIBLE_VIEWS = new Set<View>(["overview","price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","category-intelligence","products","downloads","data-status"]);
function isClickHouseInsightView(value: View): value is ClickHouseInsightMode { return CLICKHOUSE_INSIGHT_VIEWS.has(value); }

`;
if (!source.includes("const CLICKHOUSE_INSIGHT_VIEWS")) {
  const index = source.indexOf(defaultFiltersAnchor);
  if (index < 0) throw new Error("Lazy navigation: DEFAULT_FILTERS anchor missing");
  source = source.slice(0,index) + helper + source.slice(index);
}

source = source.replace(/view === "overview" \|\| view === "category-intelligence" \|\| view === "downloads" \? styles\.clickHouseMode : ""/g, 'DARK_VISIBLE_VIEWS.has(view) ? styles.clickHouseMode : ""');
source = source.replace(/view === "overview" \|\| view === "category-intelligence" \|\| view === "downloads" \? styles\.clickHouseMain : ""/g, 'DARK_VISIBLE_VIEWS.has(view) ? styles.clickHouseMain : ""');
source = source.replace(/view === "overview" \? styles\.clickHouseMode : ""/g, 'DARK_VISIBLE_VIEWS.has(view) ? styles.clickHouseMode : ""');
source = source.replace(/view === "overview" \? styles\.clickHouseMain : ""/g, 'DARK_VISIBLE_VIEWS.has(view) ? styles.clickHouseMain : ""');

const mainOld = '{view === "overview" ? <ClickHouseOverview onNavigate={(target) => navigate(target as View)}/> : <>';
const mainNew = '{view === "overview" ? <ClickHouseLanding/> : isClickHouseInsightView(view) ? <ClickHouseInsightView mode={view}/> : view === "category-intelligence" ? <CategoryIntelligence/> : <>';
if (source.includes(mainOld)) source = source.replace(mainOld, mainNew);
else if (!source.includes('<ClickHouseLanding/> : isClickHouseInsightView(view)')) throw new Error("Lazy navigation: main conditional missing");

const initialEffect = /  useEffect\(\(\) => \{\n    const initial = window\.location\.hash\.replace\("#", ""\) as View;[\s\S]*?\n  \}, \[loadCore\]\);/;
if (initialEffect.test(source)) {
  source = source.replace(initialEffect, `  useEffect(() => {
    const initial = window.location.hash.replace("#", "") as View;
    if (initial && COPY[initial]) setView(initial);
    const onHashChange = () => { const next = window.location.hash.replace("#", "") as View; if (next && COPY[next]) setView(next); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (LAZY_VISIBLE_VIEWS.has(view)) return;
    void loadCore();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 30000);
    return () => window.clearInterval(interval);
  }, [loadCore, view]);`);
}

source = source.replace(
  '  useEffect(() => { const timeout = window.setTimeout(() => void loadProducts(), 250); return () => window.clearTimeout(timeout); }, [loadProducts]);',
  '  useEffect(() => { if (LAZY_VISIBLE_VIEWS.has(view)) return; const timeout = window.setTimeout(() => void loadProducts(), 250); return () => window.clearTimeout(timeout); }, [loadProducts, view]);',
);
source = source.replace(
  '  useEffect(() => { const timeout = window.setTimeout(() => void loadMatches(), 250); return () => window.clearTimeout(timeout); }, [loadMatches]);',
  '  useEffect(() => { if (LAZY_VISIBLE_VIEWS.has(view)) return; const timeout = window.setTimeout(() => void loadMatches(), 250); return () => window.clearTimeout(timeout); }, [loadMatches, view]);',
);
source = source.replace(
  '  useEffect(() => { const timeout = window.setTimeout(() => void loadCascadeOptions(), 80); return () => window.clearTimeout(timeout); }, [loadCascadeOptions]);',
  '  useEffect(() => { if (LAZY_VISIBLE_VIEWS.has(view)) return; const timeout = window.setTimeout(() => void loadCascadeOptions(), 80); return () => window.clearTimeout(timeout); }, [loadCascadeOptions, view]);',
);

const trendStart = '  useEffect(() => {\n    if (!activeSeries.length) return;\n    const controller = new AbortController();';
if (source.includes(trendStart)) {
  source = source.replace(trendStart, '  useEffect(() => {\n    if (LAZY_VISIBLE_VIEWS.has(view) || !activeSeries.length) return;\n    const controller = new AbortController();');
  source = source.replace('  }, [filters.period, seriesKey]);', '  }, [filters.period, seriesKey, view]);');
}

if (!source.includes('label: "Evolución de precios"') || !source.includes('label: "Estado de datos"')) throw new Error("Lazy navigation: compact menu not installed");
if (!source.includes('products: { title: "Productos"')) throw new Error("Lazy navigation: Products copy missing");
if (!source.includes('if (LAZY_VISIBLE_VIEWS.has(view)) return;')) throw new Error("Lazy navigation: legacy prefetch guard missing");
if (!source.includes('<ClickHouseLanding/>')) throw new Error("Lazy navigation: lightweight landing missing");
fs.writeFileSync(appPath, source);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* clickhouse-lazy-navigation-v3 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.clickHouseMode .sidebar{padding:14px 10px 12px!important}.clickHouseMode .brand{margin-bottom:10px!important;padding:6px 6px 10px!important}.clickHouseMode .nav{display:grid!important;gap:5px!important}.clickHouseMode .navGroup{margin:0!important;padding:0!important}.clickHouseMode .navGroup+ .navGroup{margin-top:5px!important;padding-top:7px!important;border-top:1px solid #1d252e}.clickHouseMode .navGroup h3{margin:0 5px 4px!important;font-size:8px!important;letter-spacing:.12em!important}.clickHouseMode .navGroup button{min-height:34px!important;margin:0!important;padding:6px 8px!important;border-radius:7px!important;font-size:10px!important;line-height:1.1!important}.clickHouseMode .navGroup button>i{width:24px!important;height:24px!important;margin-right:7px!important;border-radius:6px!important}.clickHouseMode .account{margin-top:10px!important;padding:9px!important}.clickHouseMain{overflow-x:hidden}@media(max-width:1020px){.clickHouseMode .sidebar{padding:10px!important}}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log("Lazy ClickHouse navigation and compact sidebar applied");
