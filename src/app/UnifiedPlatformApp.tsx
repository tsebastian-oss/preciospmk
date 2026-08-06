"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./UnifiedPlatformApp.module.css";

type Numeric = number | string;
type View = "overview" | "price-image" | "price-matching" | "competitive" | "optimizer" | "promotions" | "assortment" | "movements" | "basket" | "products" | "categories" | "retailers" | "downloads" | "alerts" | "scraping" | "settings";
type RetailerType = "all" | "supermarket" | "department_store" | "pharmacy";
type Summary = { total_products: Numeric; in_stock_products: Numeric; offers: Numeric; supermarkets: Numeric; average_price: Numeric; total_savings: Numeric; last_updated: string | null };
type RetailerSummary = { supermarket: string; products: Numeric; in_stock: Numeric; offers: Numeric; average_price: Numeric; average_discount: Numeric; last_updated: string | null };
type CategorySummary = { supermarket: string; category: string; products: Numeric };
type CrawlRun = { id: number; status: string; tasks_total: number; tasks_completed: number; tasks_failed: number; products_found: number; source_counts?: Record<string, number> };
type Product = { id: string; supermarket: string; external_id: string; name: string; brand: string | null; category: string | null; smart_category?: string | null; url: string; image_url: string | null; regular_price: Numeric | null; offer_price: Numeric; in_stock: boolean; observed_at: string; savings: Numeric; discount_pct: Numeric };
type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; categories: CategorySummary[]; run: CrawlRun | null; topOffers: Product[]; error?: string };
type ProductsPayload = { products: Product[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };
type MatchListing = { id: string; supermarket: string; name: string; brand: string | null; price: Numeric; regular_price: Numeric | null; in_stock: boolean; url: string; image_url?: string | null; observed_at: string };
type ProductMatch = { match_key: string; canonical_name: string; canonical_brand: string | null; category: string | null; listings: number; supermarkets: number; best_price: Numeric; highest_price: Numeric; average_price: Numeric; price_gap: Numeric; savings_pct: Numeric; last_updated: string; best_supermarket: string; best_url: string; image_url?: string | null; store_listings: MatchListing[]; match_method?: string; confidence?: Numeric };
type MatchesPayload = { matches: ProductMatch[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };
type StorePulse = { supermarket: string; variationPct: number | null; matchedSkus: number; currentSkus: number; previousSkus: number; coveragePct: number | null; status: "ready" | "building"; confidence: string; latestObservationAt: string | null };
type PulsePayload = { data: StorePulse[]; latestObservationAt: string | null; previousDate: string | null; error?: string };
type TrendPoint = { date: string; price: number | null; skus: number | null };
type TrendSeries = { id: string; label: string; dimension: "category" | "brand"; kind: "group" | "smart" | "brand"; points: TrendPoint[] };
type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; pollingSeconds?: number; error?: string };
type FilterOption = { id: string; label: string; kind: "group" | "smart" | "brand"; products: number; retailers: number };
type FilterPayload = { defaults: string[]; categories: FilterOption[]; brands: FilterOption[]; maxSeries: number; industrySlug?: string | null; error?: string };
type ExportFormat = "xlsx" | "csv";
type ExportJob = { id: string; format: ExportFormat; status: "queued" | "processing" | "completed" | "failed" | "expired"; parameters: { startDate?: string; endDate?: string; supermarket?: string | null; category?: string | null; selectedProductCount?: number }; result_url: string | null; result_metadata: { rows?: number; bytes?: number; expiresAt?: string } | null; error_message: string | null; requested_at: string };
type ExportPayload = { exports: ExportJob[]; availability?: { firstDate: string | null; lastDate: string | null; observations: number; products: number; retailers: Array<{ supermarket: string; observations: number }> } | null; error?: string };

type Filters = { retailerType: RetailerType; supermarket: string; category: string; brand: string; query: string; stock: "all" | "in" | "out"; period: number };
type MenuItem = { view: View; label: string; icon: string };
type MenuGroup = { label: string; items: MenuItem[] };

const MENU: MenuGroup[] = [
  { label: "Resumen", items: [{ view: "overview", label: "Resumen ejecutivo", icon: "⌂" }] },
  { label: "Pricing Intelligence", items: [
    { view: "price-image", label: "Price Image", icon: "◉" },
    { view: "price-matching", label: "Price Matching", icon: "⇄" },
    { view: "competitive", label: "Competitive AI", icon: "✦" },
    { view: "optimizer", label: "AI Price Optimizer", icon: "↗" },
  ] },
  { label: "Commercial Intelligence", items: [
    { view: "promotions", label: "Promociones", icon: "%" },
    { view: "assortment", label: "Assortment Gaps", icon: "▦" },
    { view: "movements", label: "Price Movements", icon: "⌁" },
    { view: "basket", label: "Basket Simulator", icon: "▤" },
  ] },
  { label: "Catálogo", items: [
    { view: "products", label: "Product Explorer", icon: "□" },
    { view: "categories", label: "Categorías", icon: "▦" },
    { view: "retailers", label: "Retailers", icon: "⌂" },
  ] },
  { label: "Data & Operations", items: [
    { view: "downloads", label: "Descarga de bases", icon: "↓" },
    { view: "alerts", label: "Alertas", icon: "!" },
    { view: "scraping", label: "Scraping Status", icon: "↻" },
    { view: "settings", label: "Configuración", icon: "⚙" },
  ] },
];

const VIEW_COPY: Record<View, { title: string; description: string }> = {
  overview: { title: "Resumen Ejecutivo", description: "Panorama general del monitoreo de precios, surtido y actividad competitiva en Chile." },
  "price-image": { title: "Price Image", description: "Compara el nivel de precios de cada cadena contra el promedio del mercado." },
  "price-matching": { title: "Price Matching", description: "Compara productos homologados entre Lider, Jumbo y Santa Isabel." },
  competitive: { title: "Competitive AI", description: "Analiza posición de precio, riesgo competitivo y acciones sugeridas por producto." },
  optimizer: { title: "AI Price Optimizer", description: "Simula precios para equilibrar volumen, ingresos y margen." },
  promotions: { title: "Promotion Intelligence", description: "Explora descuentos activos, profundidad promocional y ahorro disponible." },
  assortment: { title: "Assortment Gaps", description: "Detecta brechas de surtido comparables entre cadenas y categorías." },
  movements: { title: "Price Movements", description: "Monitorea variaciones diarias y tendencias de categorías o marcas." },
  basket: { title: "Basket Simulator", description: "Compara el costo de una canasta homologada entre supermercados." },
  products: { title: "Product Explorer", description: "Consulta el catálogo monitoreado con filtros de cadena, stock y búsqueda." },
  categories: { title: "Categorías", description: "Revisa cobertura y profundidad de categorías por retailer." },
  retailers: { title: "Retailers", description: "Estado comercial y operativo de todas las fuentes monitoreadas." },
  downloads: { title: "Descarga de bases", description: "Genera archivos Excel o CSV con los filtros y permisos de tu organización." },
  alerts: { title: "Alertas", description: "Prioriza alzas, bajas, brechas, quiebres y problemas de captura." },
  scraping: { title: "Scraping Status", description: "Controla la salud del pipeline, avance y actualización por retailer." },
  settings: { title: "Configuración", description: "Administra industria, preferencias visuales y comportamiento del dashboard." },
};

const integer = new Intl.NumberFormat("es-CL");
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const STORE_TYPES: Record<string, Exclude<RetailerType, "all">> = {
  lider: "supermarket", jumbo: "supermarket", "santa isabel": "supermarket",
  paris: "department_store", falabella: "department_store", ripley: "department_store",
  salcobrand: "pharmacy", "cruz verde": "pharmacy", "farmacias ahumada": "pharmacy", ahumada: "pharmacy",
};
const DEFAULT_FILTERS: Filters = { retailerType: "all", supermarket: "", category: "", brand: "", query: "", stock: "all", period: 30 };
const SERIES_COLORS = ["#2563eb", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#64748b", "#14b8a6"];

function n(value: Numeric | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function num(value: Numeric | null | undefined) { return integer.format(n(value)); }
function cash(value: Numeric | null | undefined) { return currency.format(n(value)); }
function pct(value: number | null | undefined, digits = 1) { if (value === null || value === undefined || !Number.isFinite(value)) return "—"; const v = Math.abs(value) < .005 ? 0 : value; return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`; }
function dateTime(value: string | null | undefined) { if (!value) return "Sin actualización"; return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function dateValue(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function typeFor(name: string): Exclude<RetailerType, "all"> { return STORE_TYPES[name.toLocaleLowerCase("es-CL")] ?? "department_store"; }
function productPrice(product: Product) { return n(product.offer_price) > 0 ? n(product.offer_price) : n(product.regular_price); }
function combineQuery(filters: Filters) { return [filters.query.trim(), filters.brand].filter(Boolean).join(" ").trim(); }
function downloadUrl(url: string) { const anchor = document.createElement("a"); anchor.href = url; anchor.rel = "noreferrer"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }

function Metric({ label, value, detail, tone = "blue" }: { label: string; value: string; detail: string; tone?: "blue" | "green" | "purple" | "orange" }) {
  return <article className={styles.metric}><i className={`${styles.metricDot} ${styles[tone]}`} /><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function Loading({ label = "Cargando datos…" }: { label?: string }) { return <div className={styles.loading}><i />{label}</div>; }
function Empty({ label }: { label: string }) { return <div className={styles.empty}>{label}</div>; }

export default function UnifiedPlatformApp() {
  const [view, setView] = useState<View>("overview");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [products, setProducts] = useState<ProductsPayload>({ products: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [pulse, setPulse] = useState<PulsePayload | null>(null);
  const [trend, setTrend] = useState<TrendPayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterPayload | null>(null);
  const [activeSeries, setActiveSeries] = useState<string[]>([]);
  const [productPage, setProductPage] = useState(1);
  const [matchPage, setMatchPage] = useState(1);
  const [productSort, setProductSort] = useState("updated_desc");
  const [matchSort, setMatchSort] = useState("gap_desc");
  const [minSavings, setMinSavings] = useState("0");
  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [basketKeys, setBasketKeys] = useState<string[]>([]);
  const [competitiveKey, setCompetitiveKey] = useState("");
  const [optimizer, setOptimizer] = useState({ price: 0, cost: 0, units: 100, elasticity: -1.2, margin: 20 });
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [exportStart, setExportStart] = useState(dateValue(new Date(Date.now() - 6 * 86400000)));
  const [exportEnd, setExportEnd] = useState(dateValue(new Date()));
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [generatingExport, setGeneratingExport] = useState(false);

  const loadCore = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingCore(true);
    try {
      const [dashRes, pulseRes, optionRes, exportRes] = await Promise.all([
        fetch(`/api/dashboard?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/weighted-price-pulse?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/daily-pricing-filter-options?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/data-exports?live=${Date.now()}`, { cache: "no-store" }),
      ]);
      const [dash, pulseData, options, exportData] = await Promise.all([
        dashRes.json() as Promise<DashboardPayload>, pulseRes.json() as Promise<PulsePayload>, optionRes.json() as Promise<FilterPayload>, exportRes.json() as Promise<ExportPayload>,
      ]);
      if (!dashRes.ok) throw new Error(dash.error || "No fue posible cargar la plataforma");
      setDashboard(dash);
      if (pulseRes.ok) setPulse(pulseData);
      if (optionRes.ok) {
        setFilterOptions(options);
        setActiveSeries((current) => current.length ? current : (options.defaults ?? []).slice(0, 4));
      }
      if (exportRes.ok) setExportJobs(exportData.exports ?? []);
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando la plataforma"); }
    finally { if (!quiet) setLoadingCore(false); }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    const params = new URLSearchParams({ page: String(productPage), pageSize: "30", sort: productSort });
    const query = combineQuery(filters);
    if (query) params.set("q", query);
    if (filters.supermarket) params.set("supermarket", filters.supermarket);
    if (filters.stock !== "all") params.set("stock", filters.stock);
    if (filters.category) params.set("category", filters.category);
    if (filters.brand) params.set("brand", filters.brand);
    if (view === "promotions") params.set("offerOnly", "true");
    try {
      const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as ProductsPayload;
      if (!response.ok) throw new Error(data.error || "No fue posible cargar productos");
      setProducts(data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando productos"); }
    finally { setLoadingProducts(false); }
  }, [filters, productPage, productSort, view]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    const params = new URLSearchParams({ page: String(matchPage), pageSize: "30", sort: matchSort, minSavings });
    const query = combineQuery(filters);
    if (query) params.set("q", query);
    if (filters.category) params.set("category", filters.category);
    if (filters.brand) params.set("brand", filters.brand);
    try {
      const response = await fetch(`/api/matches?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as MatchesPayload;
      if (!response.ok) throw new Error(data.error || "No fue posible cargar Price Matching");
      setMatches(data);
      setCompetitiveKey((current) => current || data.matches[0]?.match_key || "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando matches"); }
    finally { setLoadingMatches(false); }
  }, [filters, matchPage, matchSort, minSavings]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as View;
    if (hash && VIEW_COPY[hash]) setView(hash);
    void loadCore();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 30000);
    return () => window.clearInterval(interval);
  }, [loadCore]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadProducts(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadProducts]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void loadMatches(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadMatches]);

  const seriesKey = activeSeries.join("|");
  useEffect(() => {
    if (!activeSeries.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(filters.period), live: String(Date.now()) });
    activeSeries.forEach((series) => params.append("series", series));
    fetch(`/api/daily-pricing-trend?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json() as TrendPayload; if (!response.ok) throw new Error(data.error || "No fue posible cargar la tendencia"); setTrend(data); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setNotice(error instanceof Error ? error.message : "Error cargando tendencia"); });
    return () => controller.abort();
  }, [filters.period, seriesKey]);

  const summary = dashboard?.summary;
  const retailers = useMemo(() => (dashboard?.supermarkets ?? []).filter((retailer) => {
    if (filters.retailerType !== "all" && typeFor(retailer.supermarket) !== filters.retailerType) return false;
    if (filters.supermarket && retailer.supermarket !== filters.supermarket) return false;
    return true;
  }), [dashboard, filters.retailerType, filters.supermarket]);
  const categories = useMemo(() => {
    const rows = dashboard?.categories ?? [];
    return rows.filter((row) => (!filters.supermarket || row.supermarket === filters.supermarket) && (!filters.category || row.category === filters.category));
  }, [dashboard, filters.supermarket, filters.category]);
  const categoryOptions = filterOptions?.categories ?? [];
  const brandOptions = filterOptions?.brands ?? [];
  const pulseMap = useMemo(() => new Map((pulse?.data ?? []).map((item) => [item.supermarket.toLocaleLowerCase("es-CL"), item])), [pulse]);
  const weightedVariation = useMemo(() => { const ready = (pulse?.data ?? []).filter((item) => item.variationPct !== null); const weight = ready.reduce((sum, item) => sum + Math.max(1, item.matchedSkus), 0); return weight ? ready.reduce((sum, item) => sum + (item.variationPct ?? 0) * Math.max(1, item.matchedSkus), 0) / weight : null; }, [pulse]);
  const stockCoverage = summary ? n(summary.in_stock_products) / Math.max(1, n(summary.total_products)) * 100 : 0;
  const crawlProgress = dashboard?.run?.tasks_total ? dashboard.run.tasks_completed / dashboard.run.tasks_total * 100 : 100;
  const marketAverage = retailers.length ? retailers.reduce((sum, item) => sum + n(item.average_price) * Math.max(1, n(item.products)), 0) / retailers.reduce((sum, item) => sum + Math.max(1, n(item.products)), 0) : 0;
  const selectedMatch = matches.matches.find((item) => item.match_key === competitiveKey) ?? matches.matches[0];
  const selectedBasket = matches.matches.filter((item) => basketKeys.includes(item.match_key));

  const trendChart = useMemo(() => {
    const series = (trend?.series ?? []).map((item, index) => {
      const valid = item.points.filter((point) => point.price && point.price > 0);
      const base = valid[0]?.price ?? 1;
      return { ...item, color: SERIES_COLORS[index % SERIES_COLORS.length], points: item.points.map((point) => ({ ...point, index: point.price ? point.price / base * 100 : null })) };
    });
    const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
    const width = 1100, height = 320, margin = { top: 22, right: 24, bottom: 46, left: 54 }, plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
    const values = series.flatMap((item) => item.points.map((point) => point.index)).filter((value): value is number => value !== null && Number.isFinite(value));
    const min = Math.floor(Math.min(...values, 95) - 2), max = Math.ceil(Math.max(...values, 105) + 2);
    const x = (index: number) => margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
    const y = (value: number) => margin.top + (max - value) / Math.max(1, max - min) * plotHeight;
    const maps = new Map(series.map((item) => [item.id, new Map(item.points.map((point) => [point.date, point.index]))]));
    const path = (id: string) => dates.map((date, index) => { const value = maps.get(id)?.get(date); return value === null || value === undefined ? null : { x: x(index), y: y(value) }; }).filter((point): point is { x: number; y: number } => point !== null).map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    return { series, dates, width, height, margin, min, max, x, y, path };
  }, [trend]);

  function navigate(next: View) { setView(next); setMobileOpen(false); setProductPage(1); setMatchPage(1); window.history.replaceState(null, "", `#${next}`); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) { setFilters((current) => ({ ...current, [key]: value })); setProductPage(1); setMatchPage(1); }
  function clearFilters() { setFilters(DEFAULT_FILTERS); setProductPage(1); setMatchPage(1); }
  function addSeries(id: string) { if (!id) return; setActiveSeries((current) => current.includes(id) ? current : [...current, id].slice(0, filterOptions?.maxSeries ?? 8)); }

  async function createExport(event: FormEvent) {
    event.preventDefault(); setGeneratingExport(true);
    try {
      const response = await fetch("/api/data-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate: exportStart, endDate: exportEnd, supermarket: filters.supermarket || null, category: filters.category || null, productIds: [], format: exportFormat }) });
      const data = await response.json() as { job?: ExportJob; error?: string; detail?: string };
      if (!response.ok || !data.job) throw new Error(data.error || data.detail || "No fue posible generar el archivo");
      setExportJobs((current) => [data.job as ExportJob, ...current]);
      if (data.job.status === "completed" && data.job.result_url) downloadUrl(data.job.result_url);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error generando archivo"); }
    finally { setGeneratingExport(false); }
  }

  const activeCopy = VIEW_COPY[view];
  const alertItems = useMemo(() => {
    const items: Array<{ tone: string; title: string; detail: string }> = [];
    (pulse?.data ?? []).forEach((item) => { if ((item.variationPct ?? 0) > 1) items.push({ tone: "danger", title: `Alza relevante en ${item.supermarket}`, detail: `${pct(item.variationPct)} en la canasta comparable.` }); if ((item.variationPct ?? 0) < -1) items.push({ tone: "success", title: `Baja relevante en ${item.supermarket}`, detail: `${pct(item.variationPct)} versus el día anterior.` }); });
    if ((dashboard?.run?.tasks_failed ?? 0) > 0) items.push({ tone: "danger", title: "Tareas de scraping con error", detail: `${num(dashboard?.run?.tasks_failed)} tareas requieren revisión.` });
    if (matches.matches[0]) items.push({ tone: "info", title: "Brecha competitiva destacada", detail: `${matches.matches[0].canonical_name}: ${cash(matches.matches[0].price_gap)} entre cadenas.` });
    return items;
  }, [pulse, dashboard, matches.matches]);

  return <div className={styles.app}>
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`}>
      <button className={styles.brand} onClick={() => navigate("overview")}><span className={styles.logo}><i/><i/><i/></span><span><strong>MGP Intelligence</strong><small>Commerce Decision Platform</small></span></button>
      <nav className={styles.navigation}>{MENU.map((group) => <section key={group.label} className={styles.navGroup}><h3>{group.label}</h3>{group.items.map((item) => <button key={item.view} className={view === item.view ? styles.activeNav : ""} onClick={() => navigate(item.view)}><i>{item.icon}</i><span>{item.label}</span>{item.view === "alerts" && alertItems.length > 0 && <b>{alertItems.length}</b>}</button>)}</section>)}</nav>
      <div className={styles.account}><div><span>MG</span><div><strong>MGP Team</strong><small>Administrador</small></div></div><hr/><small>Plan Enterprise</small><p>{num(summary?.total_products)} SKU monitoreados</p><div><i style={{ width: `${Math.min(100, stockCoverage)}%` }}/></div><strong><em/> Pipeline operativo</strong></div>
    </aside>

    <main className={styles.main}>
      <header className={styles.topbar}>
        <button className={styles.menuButton} onClick={() => setMobileOpen((value) => !value)}>☰</button>
        <div className={styles.pageTitle}><span>{MENU.find((group) => group.items.some((item) => item.view === view))?.label}</span><h1>{activeCopy.title}</h1><p>{activeCopy.description}</p></div>
        <label className={styles.search}><span>⌕</span><input value={filters.query} onChange={(event) => setFilter("query", event.target.value)} placeholder="Buscar productos, marcas o categorías…"/></label>
        <button className={styles.headerControl}><span>▣</span> Últimos {filters.period} días</button>
        <button className={styles.headerControl}><span>▱</span> {filterOptions?.industrySlug || "Todas las industrias"}</button>
      </header>

      {notice && <div className={styles.notice}>{notice}<button onClick={() => setNotice("")}>×</button></div>}

      <section className={styles.filters}>
        <div className={styles.typeFilter}><span>Tipo de retailer</span><div>{(["all", "supermarket", "department_store", "pharmacy"] as RetailerType[]).map((type) => <button key={type} className={filters.retailerType === type ? styles.selected : ""} onClick={() => setFilter("retailerType", type)}>{type === "all" ? "Todos" : type === "supermarket" ? "Supermercados" : type === "department_store" ? "Multitiendas" : "Farmacias"}</button>)}</div></div>
        <label><span>Cadena</span><select value={filters.supermarket} onChange={(event) => setFilter("supermarket", event.target.value)}><option value="">Todas</option>{(dashboard?.supermarkets ?? []).filter((item) => filters.retailerType === "all" || typeFor(item.supermarket) === filters.retailerType).map((item) => <option key={item.supermarket}>{item.supermarket}</option>)}</select></label>
        <label><span>Categoría</span><select value={filters.category} onChange={(event) => setFilter("category", event.target.value)}><option value="">Todas</option>{categoryOptions.slice(0, 150).map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <label><span>Marca</span><select value={filters.brand} onChange={(event) => setFilter("brand", event.target.value)}><option value="">Todas</option>{brandOptions.slice(0, 150).map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select></label>
        <label><span>Stock</span><select value={filters.stock} onChange={(event) => setFilter("stock", event.target.value as Filters["stock"])}><option value="all">Todo</option><option value="in">Disponible</option><option value="out">Sin stock</option></select></label>
        <label><span>Período</span><select value={filters.period} onChange={(event) => setFilter("period", Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label>
        <button className={styles.clear} onClick={clearFilters}>⌫ Limpiar</button>
      </section>

      {view === "overview" && <Overview loading={loadingCore} summary={summary} retailers={retailers} pulse={pulse} pulseMap={pulseMap} matches={matches} trendChart={trendChart} stockCoverage={stockCoverage} weightedVariation={weightedVariation} crawlProgress={crawlProgress} navigate={navigate} />}
      {view === "price-image" && <PriceImage retailers={retailers} marketAverage={marketAverage} />}
      {view === "price-matching" && <PriceMatching loading={loadingMatches} payload={matches} page={matchPage} setPage={setMatchPage} sort={matchSort} setSort={setMatchSort} minSavings={minSavings} setMinSavings={setMinSavings} />}
      {view === "competitive" && <CompetitiveAI loading={loadingMatches} matches={matches.matches} selectedKey={competitiveKey} setSelectedKey={setCompetitiveKey} />}
      {view === "optimizer" && <Optimizer match={selectedMatch} matches={matches.matches} selectedKey={competitiveKey} setSelectedKey={setCompetitiveKey} state={optimizer} setState={setOptimizer} />}
      {view === "promotions" && <ProductsView title="Promociones activas" loading={loadingProducts} payload={products} page={productPage} setPage={setProductPage} sort={productSort} setSort={setProductSort} promotions />}
      {view === "assortment" && <Assortment categories={categories} retailers={retailers} />}
      {view === "movements" && <Movements pulse={pulse} trendChart={trendChart} activeSeries={activeSeries} setActiveSeries={setActiveSeries} addSeries={addSeries} categoryOptions={categoryOptions} brandOptions={brandOptions} />}
      {view === "basket" && <Basket matches={matches.matches} selected={selectedBasket} keys={basketKeys} setKeys={setBasketKeys} />}
      {view === "products" && <ProductsView title="Catálogo de productos" loading={loadingProducts} payload={products} page={productPage} setPage={setProductPage} sort={productSort} setSort={setProductSort} />}
      {view === "categories" && <CategoriesView categories={categories} />}
      {view === "retailers" && <RetailersView retailers={retailers} pulseMap={pulseMap} />}
      {view === "downloads" && <Downloads filters={filters} format={exportFormat} setFormat={setExportFormat} start={exportStart} setStart={setExportStart} end={exportEnd} setEnd={setExportEnd} jobs={exportJobs} generating={generatingExport} submit={createExport} />}
      {view === "alerts" && <Alerts items={alertItems} />}
      {view === "scraping" && <Scraping run={dashboard?.run ?? null} retailers={dashboard?.supermarkets ?? []} progress={crawlProgress} refresh={() => void loadCore()} />}
      {view === "settings" && <Settings industry={filterOptions?.industrySlug ?? null} />}
    </main>
  </div>;
}

function Overview({ loading, summary, retailers, pulse, pulseMap, matches, trendChart, stockCoverage, weightedVariation, crawlProgress, navigate }: { loading: boolean; summary: Summary | null | undefined; retailers: RetailerSummary[]; pulse: PulsePayload | null; pulseMap: Map<string, StorePulse>; matches: MatchesPayload; trendChart: ReturnType<typeof buildPlaceholder>; stockCoverage: number; weightedVariation: number | null; crawlProgress: number; navigate: (view: View) => void }) {
  const maxVariation = Math.max(2, ...(pulse?.data ?? []).map((item) => Math.abs(item.variationPct ?? 0)));
  return <>
    <section className={styles.metrics}><Metric label="SKUs monitoreados" value={loading ? "—" : num(summary?.total_products)} detail="Catálogo consolidado" tone="purple"/><Metric label="Retailers activos" value={loading ? "—" : num(retailers.length)} detail="Fuentes visibles"/><Metric label="Observaciones del día" value={loading ? "—" : num(trendChart.currentObservations)} detail="Actualización continua"/><Metric label="Variación ponderada" value={loading ? "—" : pct(weightedVariation)} detail="Mismos SKU vs. ayer" tone="green"/><Metric label="Matches detectados" value={loading ? "—" : num(matches.total)} detail="Tres supermercados" tone="purple"/><Metric label="Cobertura de stock" value={loading ? "—" : `${stockCoverage.toFixed(1)}%`} detail="SKU disponibles" tone="green"/></section>
    <section className={styles.overviewGrid}>
      <article className={`${styles.card} ${styles.variationCard}`}><CardHead title="Variación ponderada por cadena" subtitle="Mismos SKU contra el día anterior" action="Ver detalle" onAction={() => navigate("movements")}/><div className={styles.barChart}><div className={styles.barAxis}><span>+{maxVariation.toFixed(0)}%</span><span>0%</span><span>-{maxVariation.toFixed(0)}%</span></div><div className={styles.barGrid}><i/><i/><i/></div><div className={styles.barItems}>{retailers.map((retailer) => { const value = pulseMap.get(retailer.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null; const height = value === null ? 2 : Math.max(6, Math.abs(value) / maxVariation * 46); return <div key={retailer.supermarket}><b>{value === null ? "—" : pct(value)}</b><span><i className={value === null ? styles.noBar : value >= 0 ? styles.upBar : styles.downBar} style={{ height: `${height}%`, top: value !== null && value < 0 ? "50%" : `${50 - height}%` }}/></span><small>{retailer.supermarket.replace("Farmacias ", "")}</small></div>; })}</div></div></article>
      <article className={`${styles.card} ${styles.matchSummary}`}><CardHead title="Price Matching" subtitle="Cobertura completa en tres cadenas" action="Abrir módulo" onAction={() => navigate("price-matching")}/><div className={styles.ringRow}><Ring value={compact.format(matches.total)} label="Matches" color="#2563eb"/><Ring value={`${Math.max(0, ...matches.matches.map((item) => n(item.savings_pct))).toFixed(0)}%`} label="Mayor ahorro" color="#10b981"/><Ring value={cash(Math.max(0, ...matches.matches.map((item) => n(item.price_gap))))} label="Mayor brecha" color="#8b5cf6"/></div><div className={styles.miniTable}>{matches.matches.slice(0, 5).map((match) => <button key={match.match_key} onClick={() => navigate("price-matching")}><span><strong>{match.canonical_name}</strong><small>{match.canonical_brand || match.category || "Sin marca"}</small></span><b>{cash(match.best_price)}</b><em>{cash(match.price_gap)}</em></button>)}</div></article>
      <aside className={styles.sideRail}><QuickAction title="Descarga de bases" copy="Exporta Excel o CSV con filtros." button="Configurar descarga" onClick={() => navigate("downloads")}/><QuickAction title="IA / Insights" copy="Prioriza brechas, alzas y oportunidades." button="Abrir Competitive AI" onClick={() => navigate("competitive")}/><article className={styles.card}><CardHead title="Estado del scraping" subtitle={`${crawlProgress.toFixed(0)}% del ciclo`}/><div className={styles.statusList}>{retailers.slice(0, 6).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><small>{dateTime(item.last_updated)}</small></div>)}</div></article></aside>
      <article className={`${styles.card} ${styles.overviewTrend}`}><CardHead title="Evolución de precios promedio" subtitle="Índice base 100 por categoría y marca" action="Configurar series" onAction={() => navigate("movements")}/><TrendSvg chart={trendChart}/></article>
    </section>
  </>;
}

function PriceImage({ retailers, marketAverage }: { retailers: RetailerSummary[]; marketAverage: number }) {
  const rows = retailers.map((item) => ({ ...item, index: marketAverage ? n(item.average_price) / marketAverage * 100 : 100 })).sort((a, b) => a.index - b.index);
  return <section className={styles.workspace}><section className={styles.metrics}><Metric label="Promedio mercado" value={cash(marketAverage)} detail="Índice = 100"/><Metric label="Cadena más económica" value={rows[0]?.supermarket ?? "—"} detail={rows[0] ? `Índice ${rows[0].index.toFixed(1)}` : "Sin datos"} tone="green"/><Metric label="Mayor prima" value={rows.at(-1)?.supermarket ?? "—"} detail={rows.at(-1) ? `Índice ${rows.at(-1)!.index.toFixed(1)}` : "Sin datos"} tone="orange"/></section><article className={styles.card}><CardHead title="Índice de imagen de precio" subtitle="Menor a 100 = más económico que el mercado"/><div className={styles.indexList}>{rows.map((item) => <div key={item.supermarket}><header><strong>{item.supermarket}</strong><b>{item.index.toFixed(1)}</b></header><span><i className={item.index <= 100 ? styles.goodIndex : styles.highIndex} style={{ width: `${Math.min(100, Math.max(10, item.index / 1.25))}%` }}/><em style={{ left: "80%" }}/></span><footer>{cash(item.average_price)} promedio · {num(item.products)} SKU</footer></div>)}</div></article></section>;
}

function PriceMatching({ loading, payload, page, setPage, sort, setSort, minSavings, setMinSavings }: { loading: boolean; payload: MatchesPayload; page: number; setPage: (value: number | ((value: number) => number)) => void; sort: string; setSort: (value: string) => void; minSavings: string; setMinSavings: (value: string) => void }) {
  return <section className={styles.workspace}><div className={styles.toolbar}><select value={minSavings} onChange={(event) => setMinSavings(event.target.value)}><option value="0">Cualquier brecha</option><option value="5">Ahorro ≥ 5%</option><option value="10">Ahorro ≥ 10%</option><option value="20">Ahorro ≥ 20%</option></select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="gap_desc">Mayor ahorro $</option><option value="savings_desc">Mayor ahorro %</option><option value="price_asc">Menor precio</option><option value="updated_desc">Más recientes</option></select><span>{num(payload.total)} matches validados</span></div>{loading ? <Loading label="Construyendo comparaciones…"/> : <div className={styles.matchCards}>{payload.matches.map((match) => <article key={match.match_key} className={styles.card}><header><div><span className={styles.confidence}>{match.match_method === "exact" ? "Match exacto" : "IA · alta confianza"}</span><h3>{match.canonical_name}</h3><p>{match.canonical_brand || "Marca no informada"} · {match.category || "Sin categoría"}</p></div><div><small>Ahorro potencial</small><strong>{cash(match.price_gap)}</strong><b>{n(match.savings_pct).toFixed(1)}%</b></div></header><div className={styles.listingGrid}>{match.store_listings.map((listing) => <a key={listing.id} className={listing.supermarket === match.best_supermarket ? styles.winner : ""} href={listing.url} target="_blank" rel="noreferrer"><span>{listing.supermarket}</span><strong>{cash(listing.price)}</strong><small>{listing.in_stock ? "Disponible" : "Sin stock"}</small></a>)}</div></article>)}</div>}<Pagination page={page} totalPages={payload.totalPages} setPage={setPage}/></section>;
}

function CompetitiveAI({ loading, matches, selectedKey, setSelectedKey }: { loading: boolean; matches: ProductMatch[]; selectedKey: string; setSelectedKey: (value: string) => void }) {
  const match = matches.find((item) => item.match_key === selectedKey) ?? matches[0];
  if (loading) return <Loading/>;
  if (!match) return <Empty label="No existen productos comparables con los filtros actuales."/>;
  const midpoint = (n(match.best_price) + n(match.highest_price)) / 2;
  return <section className={styles.workspace}><div className={styles.toolbar}><select value={match.match_key} onChange={(event) => setSelectedKey(event.target.value)}>{matches.map((item) => <option key={item.match_key} value={item.match_key}>{item.canonical_name}</option>)}</select><span>Analizando {match.supermarkets} cadenas</span></div><section className={styles.metrics}><Metric label="Mejor precio" value={cash(match.best_price)} detail={match.best_supermarket} tone="green"/><Metric label="Precio mercado" value={cash(match.average_price)} detail="Promedio homologado"/><Metric label="Mayor precio" value={cash(match.highest_price)} detail={`Brecha ${cash(match.price_gap)}`} tone="orange"/></section><div className={styles.twoColumn}><article className={styles.card}><CardHead title="Posición competitiva" subtitle={match.canonical_name}/><div className={styles.positionScale}><span>{cash(match.best_price)}</span><span>{cash(midpoint)}</span><span>{cash(match.highest_price)}</span><i/><b style={{ left: `${Math.min(95, Math.max(5, (n(match.average_price) - n(match.best_price)) / Math.max(1, n(match.price_gap)) * 100))}%` }}/></div><div className={styles.listingRows}>{match.store_listings.map((item) => <div key={item.id}><strong>{item.supermarket}</strong><span>{cash(item.price)}</span><b>{item.supermarket === match.best_supermarket ? "Líder" : n(item.price) > midpoint ? "Premium" : "Competitivo"}</b></div>)}</div></article><article className={styles.card}><CardHead title="Recomendación de IA" subtitle="Basada en el set competitivo actual"/><div className={styles.aiRecommendation}><i>✦</i><h3>{n(match.savings_pct) >= 10 ? "Existe una brecha relevante de precio" : "El mercado presenta una dispersión controlada"}</h3><p>{n(match.savings_pct) >= 10 ? `La diferencia alcanza ${n(match.savings_pct).toFixed(1)}%. Evalúa un precio entre ${cash(n(match.best_price) * 1.02)} y ${cash(n(match.average_price))} para mejorar competitividad sin igualar automáticamente al líder.` : `La brecha es de ${n(match.savings_pct).toFixed(1)}%. Prioriza margen, disponibilidad y ejecución promocional antes de realizar un ajuste profundo.`}</p><ul><li>Verificar stock y vigencia de precios antes de actuar.</li><li>Comparar promociones y condiciones de financiamiento.</li><li>Monitorear nuevamente durante las próximas 24 horas.</li></ul></div></article></div></section>;
}

function Optimizer({ match, matches, selectedKey, setSelectedKey, state, setState }: { match: ProductMatch | undefined; matches: ProductMatch[]; selectedKey: string; setSelectedKey: (value: string) => void; state: { price: number; cost: number; units: number; elasticity: number; margin: number }; setState: (value: { price: number; cost: number; units: number; elasticity: number; margin: number }) => void }) {
  useEffect(() => { if (match && state.price === 0) setState({ ...state, price: n(match.average_price), cost: n(match.average_price) * .65 }); }, [match]);
  if (!match) return <Empty label="Selecciona filtros con productos homologados para usar el optimizador."/>;
  const floor = state.cost / Math.max(.01, 1 - state.margin / 100);
  const competitors = match.store_listings.map((item) => n(item.price)).filter(Boolean);
  const target = Math.max(floor, Math.min(...competitors) * 0.99);
  const delta = state.price ? (target / state.price - 1) : 0;
  const projectedUnits = Math.max(0, state.units * (1 + state.elasticity * delta));
  const revenue = target * projectedUnits;
  const profit = (target - state.cost) * projectedUnits;
  return <section className={styles.workspace}><div className={styles.toolbar}><select value={selectedKey || match.match_key} onChange={(event) => setSelectedKey(event.target.value)}>{matches.map((item) => <option key={item.match_key} value={item.match_key}>{item.canonical_name}</option>)}</select></div><div className={styles.optimizerGrid}><form className={styles.card}><CardHead title="Supuestos comerciales" subtitle="Ajusta los datos de tu negocio"/><div className={styles.formGrid}><NumberField label="Precio actual" value={state.price} onChange={(price) => setState({ ...state, price })}/><NumberField label="Costo unitario" value={state.cost} onChange={(cost) => setState({ ...state, cost })}/><NumberField label="Unidades mensuales" value={state.units} onChange={(units) => setState({ ...state, units })}/><NumberField label="Elasticidad estimada" value={state.elasticity} step="0.1" onChange={(elasticity) => setState({ ...state, elasticity })}/><NumberField label="Margen mínimo %" value={state.margin} onChange={(margin) => setState({ ...state, margin })}/></div></form><article className={`${styles.card} ${styles.recommendationCard}`}><span>PRECIO RECOMENDADO</span><strong>{cash(target)}</strong><p>{pct(delta * 100)} respecto al precio actual</p><div><Metric label="Unidades proyectadas" value={num(projectedUnits)} detail="Estimación mensual" tone="green"/><Metric label="Ingresos" value={cash(revenue)} detail="Proyección mensual"/><Metric label="Utilidad bruta" value={cash(profit)} detail={`${((target - state.cost) / Math.max(1, target) * 100).toFixed(1)}% margen`} tone="purple"/></div><small>La elasticidad es estimada mientras no exista histórico propio de ventas, costos y promociones.</small></article></div></section>;
}

function ProductsView({ title, loading, payload, page, setPage, sort, setSort, promotions = false }: { title: string; loading: boolean; payload: ProductsPayload; page: number; setPage: (value: number | ((value: number) => number)) => void; sort: string; setSort: (value: string) => void; promotions?: boolean }) {
  return <section className={styles.workspace}><div className={styles.toolbar}><strong>{title}</strong><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated_desc">Más recientes</option><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="name_asc">Nombre A–Z</option></select><span>{num(payload.total)} resultados</span></div><article className={styles.card}>{loading ? <Loading/> : !payload.products.length ? <Empty label="No hay productos con los filtros seleccionados."/> : <div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Cadena</th><th>Categoría</th><th>Precio</th>{promotions && <th>Ahorro</th>}<th>Stock</th><th>Actualización</th><th/></tr></thead><tbody>{payload.products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.brand || `SKU ${product.external_id}`}</small></td><td><span className={styles.storeBadge}>{product.supermarket}</span></td><td>{product.smart_category || product.category || "Sin categoría"}</td><td><strong>{cash(productPrice(product))}</strong>{n(product.regular_price) > productPrice(product) && <del>{cash(product.regular_price)}</del>}</td>{promotions && <td><b className={styles.discount}>-{n(product.discount_pct).toFixed(0)}%</b></td>}<td><span className={product.in_stock ? styles.inStock : styles.outStock}>{product.in_stock ? "Disponible" : "Sin stock"}</span></td><td>{dateTime(product.observed_at)}</td><td><a href={product.url} target="_blank" rel="noreferrer">↗</a></td></tr>)}</tbody></table></div>}</article><Pagination page={page} totalPages={payload.totalPages} setPage={setPage}/></section>;
}

function Assortment({ categories, retailers }: { categories: CategorySummary[]; retailers: RetailerSummary[] }) {
  const categoryNames = [...new Set(categories.map((item) => item.category))];
  const totals = new Map<string, number>(); categories.forEach((item) => totals.set(item.category, (totals.get(item.category) ?? 0) + n(item.products)));
  const top = categoryNames.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).slice(0, 40);
  return <section className={styles.workspace}><article className={styles.card}><CardHead title="Matriz de surtido" subtitle="SKU observados por categoría y retailer"/><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th>{retailers.map((item) => <th key={item.supermarket}>{item.supermarket}</th>)}<th>Mayor brecha</th></tr></thead><tbody>{top.map((category) => { const values = retailers.map((retailer) => n(categories.find((row) => row.category === category && row.supermarket === retailer.supermarket)?.products)); const max = Math.max(...values, 0), min = Math.min(...values, 0); return <tr key={category}><td><strong>{category}</strong></td>{values.map((value, index) => <td key={`${category}-${index}`}><span className={styles.depthCell} style={{ opacity: .25 + (max ? value / max * .75 : 0) }}>{num(value)}</span></td>)}<td><b>{num(max - min)} SKU</b></td></tr>; })}</tbody></table></div></article></section>;
}

function Movements({ pulse, trendChart, activeSeries, setActiveSeries, addSeries, categoryOptions, brandOptions }: { pulse: PulsePayload | null; trendChart: ReturnType<typeof buildPlaceholder>; activeSeries: string[]; setActiveSeries: (value: string[] | ((value: string[]) => string[])) => void; addSeries: (id: string) => void; categoryOptions: FilterOption[]; brandOptions: FilterOption[] }) {
  const optionMap = new Map([...categoryOptions, ...brandOptions].map((item) => [item.id, item]));
  return <section className={styles.workspace}><section className={styles.pulseCards}>{(pulse?.data ?? []).map((item) => <article key={item.supermarket} className={styles.card}><span>{item.supermarket}</span><strong>{pct(item.variationPct)}</strong><p>{item.matchedSkus ? `${num(item.matchedSkus)} SKU comparables` : "Base en construcción"}</p><small>{item.coveragePct?.toFixed(1) ?? "0,0"}% cobertura</small></article>)}</section><article className={styles.card}><CardHead title="Evolución diaria" subtitle="Agrega o elimina categorías y marcas"/><div className={styles.seriesPicker}><div><span>Series activas</span>{activeSeries.map((id) => <button key={id} onClick={() => setActiveSeries((current) => current.length > 1 ? current.filter((item) => item !== id) : current)}>{optionMap.get(id)?.label ?? id} ×</button>)}</div><select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Categoría</option>{categoryOptions.filter((item) => !activeSeries.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Marca</option>{brandOptions.filter((item) => !activeSeries.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><TrendSvg chart={trendChart}/></article></section>;
}

function Basket({ matches, selected, keys, setKeys }: { matches: ProductMatch[]; selected: ProductMatch[]; keys: string[]; setKeys: (value: string[] | ((value: string[]) => string[])) => void }) {
  const stores = ["Lider", "Jumbo", "Santa Isabel"];
  const totals = new Map(stores.map((store) => [store, selected.reduce((sum, match) => sum + n(match.store_listings.find((item) => item.supermarket === store)?.price), 0)]));
  return <section className={styles.workspace}><div className={styles.basketGrid}><article className={styles.card}><CardHead title="Construye tu canasta" subtitle={`${selected.length} productos seleccionados`}/><div className={styles.basketOptions}>{matches.slice(0, 40).map((match) => <label key={match.match_key}><input type="checkbox" checked={keys.includes(match.match_key)} onChange={() => setKeys((current) => current.includes(match.match_key) ? current.filter((key) => key !== match.match_key) : [...current, match.match_key])}/><span><strong>{match.canonical_name}</strong><small>{match.canonical_brand || match.category || "Sin marca"}</small></span><b>{cash(match.average_price)}</b></label>)}</div></article><article className={styles.card}><CardHead title="Resultado de la canasta" subtitle="Solo productos presentes en las tres cadenas"/><div className={styles.basketTotals}>{stores.map((store) => <div key={store} className={totals.get(store) === Math.min(...totals.values()) && selected.length ? styles.bestBasket : ""}><span>{store}</span><strong>{selected.length ? cash(totals.get(store)) : "—"}</strong><small>{selected.length ? `${selected.length} productos` : "Selecciona productos"}</small></div>)}</div></article></div></section>;
}

function CategoriesView({ categories }: { categories: CategorySummary[] }) {
  const grouped = new Map<string, { total: number; retailers: Set<string> }>(); categories.forEach((item) => { const current = grouped.get(item.category) ?? { total: 0, retailers: new Set<string>() }; current.total += n(item.products); current.retailers.add(item.supermarket); grouped.set(item.category, current); });
  const rows = [...grouped.entries()].sort((a, b) => b[1].total - a[1].total);
  return <section className={styles.workspace}><div className={styles.categoryCards}>{rows.slice(0, 12).map(([name, item]) => <article key={name} className={styles.card}><span>{item.retailers.size} retailers</span><strong>{name}</strong><p>{num(item.total)} SKU monitoreados</p></article>)}</div><article className={styles.card}><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th><th>SKU</th><th>Retailers</th><th>Cobertura</th></tr></thead><tbody>{rows.map(([name, item]) => <tr key={name}><td><strong>{name}</strong></td><td>{num(item.total)}</td><td>{item.retailers.size}</td><td><span className={styles.coverageBar}><i style={{ width: `${Math.min(100, item.retailers.size / 9 * 100)}%` }}/></span></td></tr>)}</tbody></table></div></article></section>;
}

function RetailersView({ retailers, pulseMap }: { retailers: RetailerSummary[]; pulseMap: Map<string, StorePulse> }) {
  return <section className={styles.workspace}><div className={styles.retailerCards}>{retailers.map((item) => { const pulse = pulseMap.get(item.supermarket.toLocaleLowerCase("es-CL")); return <article key={item.supermarket} className={styles.card}><header><span className={`${styles.retailerType} ${styles[typeFor(item.supermarket)]}`}>{typeFor(item.supermarket) === "supermarket" ? "Supermercado" : typeFor(item.supermarket) === "pharmacy" ? "Farmacia" : "Multitienda"}</span><b><i/> Operativo</b></header><h3>{item.supermarket}</h3><div><strong>{num(item.products)}</strong><span>SKU monitoreados</span></div><dl><div><dt>Disponibles</dt><dd>{num(item.in_stock)}</dd></div><div><dt>Promociones</dt><dd>{num(item.offers)}</dd></div><div><dt>Precio promedio</dt><dd>{cash(item.average_price)}</dd></div><div><dt>Variación</dt><dd>{pct(pulse?.variationPct)}</dd></div></dl><footer>Actualizado {dateTime(item.last_updated)}</footer></article>; })}</div></section>;
}

function Downloads({ filters, format, setFormat, start, setStart, end, setEnd, jobs, generating, submit }: { filters: Filters; format: ExportFormat; setFormat: (value: ExportFormat) => void; start: string; setStart: (value: string) => void; end: string; setEnd: (value: string) => void; jobs: ExportJob[]; generating: boolean; submit: (event: FormEvent) => void }) {
  return <section className={styles.workspace}><div className={styles.downloadGrid}><form className={styles.card} onSubmit={submit}><CardHead title="Configura la exportación" subtitle="Los filtros globales se aplican al archivo"/><div className={styles.exportForm}><label><span>Desde</span><input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} required/></label><label><span>Hasta</span><input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} required/></label><label><span>Cadena</span><input value={filters.supermarket || "Todas las cadenas autorizadas"} readOnly/></label><label><span>Categoría</span><input value={filters.category || "Todas las categorías"} readOnly/></label></div><div className={styles.formatSelector}><button type="button" className={format === "xlsx" ? styles.selectedFormat : ""} onClick={() => setFormat("xlsx")}><strong>Excel</strong><small>Tablas dinámicas y análisis</small></button><button type="button" className={format === "csv" ? styles.selectedFormat : ""} onClick={() => setFormat("csv")}><strong>CSV</strong><small>Grandes volúmenes de datos</small></button></div><button className={styles.primaryButton} disabled={generating}>{generating ? "Generando…" : "Generar y descargar"}</button></form><aside className={styles.card}><CardHead title="Historial de descargas" subtitle={`${jobs.length} archivos recientes`}/><div className={styles.exportHistory}>{jobs.length ? jobs.map((job) => <article key={job.id}><div><b>{job.format.toUpperCase()}</b><span className={styles[job.status]}>{job.status === "completed" ? "Disponible" : job.status === "failed" ? "Fallida" : job.status === "processing" ? "Generando" : "En cola"}</span></div><strong>{job.parameters.supermarket || "Todas las cadenas"}</strong><p>{job.parameters.startDate} — {job.parameters.endDate}</p><small>{num(job.result_metadata?.rows ?? 0)} filas</small><button disabled={!job.result_url || job.status !== "completed"} onClick={() => job.result_url && downloadUrl(job.result_url)}>Descargar</button></article>) : <Empty label="Aún no existen archivos generados."/>}</div></aside></div></section>;
}

function Alerts({ items }: { items: Array<{ tone: string; title: string; detail: string }> }) {
  return <section className={styles.workspace}><div className={styles.alertGrid}>{items.length ? items.map((item, index) => <article key={`${item.title}-${index}`} className={`${styles.card} ${styles.alertCard}`}><i className={styles[item.tone]}/><div><span>{item.tone === "danger" ? "Prioridad alta" : item.tone === "success" ? "Movimiento favorable" : "Oportunidad"}</span><h3>{item.title}</h3><p>{item.detail}</p></div><button>Revisar →</button></article>) : <Empty label="No hay alertas activas con los filtros actuales."/>}</div></section>;
}

function Scraping({ run, retailers, progress, refresh }: { run: CrawlRun | null; retailers: RetailerSummary[]; progress: number; refresh: () => void }) {
  return <section className={styles.workspace}><section className={styles.metrics}><Metric label="Estado general" value={run?.status === "running" ? "Procesando" : "Operativo"} detail={`Run ${run?.id ?? "—"}`} tone="green"/><Metric label="Avance" value={`${progress.toFixed(0)}%`} detail={`${num(run?.tasks_completed)} tareas completas`}/><Metric label="Errores" value={num(run?.tasks_failed)} detail="Tareas fallidas" tone={n(run?.tasks_failed) ? "orange" : "green"}/><Metric label="Productos encontrados" value={num(run?.products_found)} detail="En la corrida actual" tone="purple"/></section><article className={styles.card}><CardHead title="Pipeline por retailer" subtitle="Última actividad registrada" action="Actualizar" onAction={refresh}/><div className={styles.scrapeRows}>{retailers.map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><strong>{num(item.products)} SKU</strong><small>{dateTime(item.last_updated)}</small></div>)}</div></article></section>;
}

function Settings({ industry }: { industry: string | null }) {
  return <section className={styles.workspace}><div className={styles.settingsGrid}><article className={styles.card}><CardHead title="Industria de la organización" subtitle="Controla el universo de datos visible"/><div className={styles.settingRow}><div><strong>{industry || "Todas las industrias"}</strong><p>La industria filtra dashboard, categorías, productos y exportaciones sin eliminar datos.</p></div><a href="/onboarding">Cambiar industria</a></div></article><article className={styles.card}><CardHead title="Preferencias del dashboard" subtitle="Configuración visual y de actualización"/><div className={styles.toggleRows}><label><span><strong>Actualización automática</strong><small>Recargar indicadores cada 30 segundos</small></span><input type="checkbox" defaultChecked/></label><label><span><strong>Mostrar datos en vivo</strong><small>Incluir el día en curso en las tendencias</small></span><input type="checkbox" defaultChecked/></label><label><span><strong>Alertas de scraping</strong><small>Destacar fuentes con errores o retrasos</small></span><input type="checkbox" defaultChecked/></label></div></article></div></section>;
}

function CardHead({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className={styles.cardHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button onClick={onAction}>{action} →</button>}</header>; }
function QuickAction({ title, copy, button, onClick }: { title: string; copy: string; button: string; onClick: () => void }) { return <article className={`${styles.card} ${styles.quickAction}`}><h3>{title}</h3><p>{copy}</p><button onClick={onClick}>{button} →</button></article>; }
function Ring({ value, label, color }: { value: string; label: string; color: string }) { return <div className={styles.ringMetric}><div style={{ "--ring-color": color } as React.CSSProperties}><span>{value}</span></div><strong>{label}</strong></div>; }
function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (value: number | ((value: number) => number)) => void }) { return <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Anterior</button><span>Página {page} de {Math.max(1, totalPages)}</span><button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente →</button></div>; }
function NumberField({ label, value, step = "1", onChange }: { label: string; value: number; step?: string; onChange: (value: number) => void }) { return <label><span>{label}</span><input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>; }
function buildPlaceholder() { return { series: [] as Array<TrendSeries & { color: string; points: Array<TrendPoint & { index: number | null }> }>, dates: [] as string[], width: 1100, height: 320, margin: { top: 22, right: 24, bottom: 46, left: 54 }, min: 95, max: 105, x: (_index: number) => 0, y: (_value: number) => 0, path: (_id: string) => "", currentObservations: 0 }; }
function TrendSvg({ chart }: { chart: ReturnType<typeof buildPlaceholder> }) { return <div className={styles.trendWrap}>{chart.series.length ? <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className={styles.trendSvg}>{[0,1,2,3,4].map((index) => { const value = chart.max - index * (chart.max - chart.min) / 4; const y = chart.y(value); return <g key={index}><line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={y} y2={y}/><text x={chart.margin.left - 10} y={y + 4}>{value.toFixed(0)}</text></g>; })}{chart.series.map((series) => <path key={series.id} d={chart.path(series.id)} stroke={series.color}/>)}{chart.dates.filter((_, index) => index === 0 || index === chart.dates.length - 1 || index % Math.max(1, Math.ceil(chart.dates.length / 6)) === 0).map((date) => { const index = chart.dates.indexOf(date); return <text key={date} className={styles.xLabel} x={chart.x(index)} y={chart.height - 12}>{new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "")}</text>; })}</svg> : <Empty label="Selecciona series con datos para construir la tendencia."/>}<footer>{chart.series.map((series) => <span key={series.id}><i style={{ background: series.color }}/>{series.label}</span>)}</footer></div>; }
