import { readFileSync, writeFileSync } from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
let app = readFileSync(appPath, "utf8");

function removeExact(value, label) {
  if (!app.includes(value)) return;
  app = app.replace(value, "");
  console.log(`Retired ${label}`);
}

function removeRange(startMarker, endMarker, label) {
  const start = app.indexOf(startMarker);
  if (start < 0) return;
  const end = app.indexOf(endMarker, start);
  if (end < 0) throw new Error(`No se encontró el final de ${label}`);
  app = app.slice(0, start) + app.slice(end);
  console.log(`Retired ${label}`);
}

for (const view of ["price-image", "price-matching", "assortment", "movements", "products", "categories", "retailers"]) {
  app = app.replace(` | "${view}"`, "");
}

for (const view of ["price-image", "price-matching", "assortment", "movements"]) {
  app = app.replace(new RegExp(`^\\s*\\{ view: "${view}"[^\\n]*\\n`, "m"), "");
}
app = app.replace(/  \{ label: "Catálogo", items: \[\n[\s\S]*?  \] \},\n/, "");

for (const key of ['"price-image"', '"price-matching"', "assortment", "movements", "products", "categories", "retailers"]) {
  app = app.replace(new RegExp(`^  ${key.replaceAll('"', '\\"')}: \\{[^\\n]*\\n`, "m"), "");
}

for (const line of [
  'type MatchListing = { id: string; supermarket: string; price: Numeric; in_stock: boolean; url: string };\n',
  'type ProductMatch = { match_key: string; canonical_name: string; canonical_brand: string | null; category: string | null; listings: number; supermarkets: number; best_price: Numeric; highest_price: Numeric; average_price: Numeric; price_gap: Numeric; savings_pct: Numeric; best_supermarket: string; store_listings: MatchListing[]; match_method?: string };\n',
  'type MatchesPayload = { matches: ProductMatch[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };\n',
  'type TrendPoint = { date: string; price: number | null; skus: number | null };\n',
  'type TrendSeries = { id: string; label: string; dimension: "category" | "brand"; kind: "group" | "smart" | "brand"; points: TrendPoint[] };\n',
  'type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; scopeLabel?: string; mode?: string; autoSelected?: boolean; error?: string };\n',
  'const SERIES_COLORS = ["#2563eb", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#64748b", "#14b8a6"];\n',
  '  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });\n',
  '  const [trend, setTrend] = useState<TrendPayload | null>(null);\n',
  '  const [activeSeries, setActiveSeries] = useState<string[]>([]);\n',
  '  const [matchPage, setMatchPage] = useState(1);\n',
  '  const [matchSort, setMatchSort] = useState("gap_desc");\n',
  '  const [minSavings, setMinSavings] = useState("0");\n',
  '  const [loadingMatches, setLoadingMatches] = useState(false);\n',
  '  const [competitiveKey, setCompetitiveKey] = useState("");\n',
  '        setActiveSeries((current) => current.length ? current : (optionsData.defaults ?? []).slice(0, 4));\n',
  '  const categoryRows = useMemo(() => (dashboard?.categories ?? []).filter((item) => (filters.retailerType === "all" || retailerType(item.supermarket) === filters.retailerType) && (!filters.supermarket || item.supermarket === filters.supermarket) && (!filters.category || item.category === filters.category)), [dashboard, filters.retailerType, filters.supermarket, filters.category]);\n',
  '  const marketAverage = retailers.length ? retailers.reduce((sum, item) => sum + numeric(item.average_price) * Math.max(1, numeric(item.products)), 0) / retailers.reduce((sum, item) => sum + Math.max(1, numeric(item.products)), 0) : 0;\n',
  '  const selectedMatch = matches.matches.find((item) => item.match_key === competitiveKey) ?? matches.matches[0];\n',
  '  function addSeries(id: string) { if (!id) return; setActiveSeries((current) => current.includes(id) ? current : [...current, id].slice(0, filterOptions?.maxSeries ?? 8)); }\n',
]) removeExact(line, line.trim().slice(0, 48));

removeRange('  const loadMatches = useCallback(async () => {', '  const loadCascadeOptions = useCallback(async () => {', "Price Matching loader");
removeRange('  useEffect(() => {\n    if (!(["overview", "price-matching", "competitive", "optimizer", "basket"] as View[]).includes(view)) return;', '  const seriesKey = activeSeries.join("|");', "Price Matching autoload");
removeRange('  const seriesKey = activeSeries.join("|");', '  useEffect(() => {\n    let cancelled = false;\n    fetch("/api/enterprise/account"', "Price Movements autoload");
removeRange('  const trendChart = useMemo(() => {', '  const alerts = useMemo<AlertItem[]>(() => {', "Price Movements chart state");
removeRange('  const renderTrend = () =>', '  const renderProducts = (promotions: boolean) =>', "Price Movements renderer");

app = app.replace('    if (!(["products", "promotions"] as View[]).includes(view)) return;', '    if (view !== "promotions") return;');
app = app.replaceAll(' setMatchPage(1);', '');
app = app.replace('    if (matches.matches[0]) items.push({ tone: "info", title: "Brecha competitiva destacada", detail: `${matches.matches[0].canonical_name}: ${money(matches.matches[0].price_gap)} entre cadenas.` });\n', '');
app = app.replace('  }, [pulse, dashboard, matches.matches]);', '  }, [pulse, dashboard]);');

app = app.replace(
  '<Metric label="Observaciones del día" value={loadingCore ? "—" : number(trendChart.currentObservations)} detail="Actualización continua"/>',
  '<Metric label="Promociones activas" value={loadingCore ? "—" : number(summary?.offers)} detail="Ofertas vigentes" tone="orange"/>',
);
removeExact('<Metric label="Matches detectados" value={loadingCore ? "—" : number(matches.total)} detail="Productos equivalentes" tone="purple"/>', "Price Matching KPI");
app = app.replace(
  '<CardHead title="Variación ponderada por cadena" subtitle="Mismos SKU contra el día anterior" action="Ver detalle" onAction={() => navigate("movements")}/>',
  '<CardHead title="Variación ponderada por cadena" subtitle="Mismos SKU contra el día anterior"/>',
);
removeRange('<article className={`${styles.card} ${styles.matchSummary}`}>', '<aside className={styles.sideRail}>', "Price Matching overview card");
removeRange('<article className={`${styles.card} ${styles.overviewTrend}`}>', '</section></>;', "Price Movements overview card");

removeRange('    if (view === "price-image") {', '    if (view === "brand-ai")', "Price Image and Price Matching views");
removeExact('    if (view === "products") return renderProducts(false);\n', "Product Explorer view");
removeRange('    if (view === "assortment") {', '    if (view === "downloads")', "Assortment, Price Movements and Catalog views");

removeExact('function Ring({ value, label, color }: { value: string; label: string; color: string }) { return <div className={styles.ringMetric}><div style={{ background: `conic-gradient(${color} 0 72%, #edf1f7 72%)` }}><span>{value}</span></div><strong>{label}</strong></div>; }\n', "Price Matching ring component");

const forbidden = [
  'view: "price-image"',
  'view: "price-matching"',
  'view: "assortment"',
  'view: "movements"',
  'view: "products"',
  'view: "categories"',
  'view: "retailers"',
  'if (view === "price-image")',
  'if (view === "price-matching")',
  'if (view === "assortment")',
  'if (view === "movements")',
  'if (view === "products")',
  'if (view === "categories")',
  'if (view === "retailers")',
  '/api/matches?',
  '/api/contextual-pricing-trend',
  '/api/daily-pricing-trend',
];
const leftovers = forbidden.filter((marker) => app.includes(marker));
if (leftovers.length) throw new Error(`Quedaron módulos retirados activos: ${leftovers.join(", ")}`);

app = app.replace(/[ \t]+\n/g, "\n");
writeFileSync(appPath, app);
console.log("Retired modules removed from navigation, overview and background loading");
