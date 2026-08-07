"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./UnifiedPlatformApp.module.css";

type Numeric = number | string;
type View = "overview" | "price-image" | "price-matching" | "competitive" | "optimizer" | "promotions" | "assortment" | "movements" | "basket" | "products" | "categories" | "retailers" | "downloads" | "alerts" | "scraping" | "settings";
type RetailerType = "all" | "supermarket" | "department_store" | "pharmacy";
type Filters = { retailerType: RetailerType; supermarket: string; category: string; brand: string; query: string; stock: "all" | "in" | "out"; period: number };
type Summary = { total_products: Numeric; in_stock_products: Numeric; offers: Numeric; supermarkets: Numeric; average_price: Numeric; total_savings: Numeric; last_updated: string | null };
type RetailerSummary = { supermarket: string; products: Numeric; in_stock: Numeric; offers: Numeric; average_price: Numeric; average_discount: Numeric; last_updated: string | null };
type CategorySummary = { supermarket: string; category: string; products: Numeric };
type CrawlRun = { id: number; status: string; tasks_total: number; tasks_completed: number; tasks_failed: number; products_found: number };
type Product = { id: string; supermarket: string; external_id: string; name: string; brand: string | null; category: string | null; smart_category?: string | null; url: string; regular_price: Numeric | null; offer_price: Numeric; in_stock: boolean; observed_at: string; discount_pct: Numeric };
type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; categories: CategorySummary[]; run: CrawlRun | null; topOffers: Product[]; error?: string };
type ProductsPayload = { products: Product[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };
type MatchListing = { id: string; supermarket: string; price: Numeric; in_stock: boolean; url: string };
type ProductMatch = { match_key: string; canonical_name: string; canonical_brand: string | null; category: string | null; listings: number; supermarkets: number; best_price: Numeric; highest_price: Numeric; average_price: Numeric; price_gap: Numeric; savings_pct: Numeric; best_supermarket: string; store_listings: MatchListing[]; match_method?: string };
type MatchesPayload = { matches: ProductMatch[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };
type StorePulse = { supermarket: string; variationPct: number | null; matchedSkus: number; currentSkus: number; coveragePct: number | null; status: "ready" | "building"; latestObservationAt: string | null };
type PulsePayload = { data: StorePulse[]; latestObservationAt: string | null; error?: string };
type TrendPoint = { date: string; price: number | null; skus: number | null };
type TrendSeries = { id: string; label: string; dimension: "category" | "brand"; kind: "group" | "smart" | "brand"; points: TrendPoint[] };
type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; error?: string };
type FilterOption = { id: string; label: string; kind: "group" | "smart" | "brand"; products: number; retailers: number };
type FilterPayload = { defaults: string[]; categories: FilterOption[]; brands: FilterOption[]; maxSeries: number; industrySlug?: string | null; error?: string };
type CascadeOption = { value: string; products: number };
type CascadePayload = { retailerType: RetailerType; supermarket: string | null; category: string | null; brand: string | null; chains: CascadeOption[]; categories: CascadeOption[]; brands: CascadeOption[]; stock: { in: number; out: number }; error?: string };
type ExportFormat = "xlsx" | "csv";
type ExportJob = { id: string; format: ExportFormat; status: "queued" | "processing" | "completed" | "failed" | "expired"; parameters: { startDate?: string; endDate?: string; supermarket?: string | null; category?: string | null }; result_url: string | null; result_metadata: { rows?: number; bytes?: number; expiresAt?: string } | null; requested_at: string };
type ExportPayload = { exports: ExportJob[]; error?: string };
type AlertItem = { tone: "danger" | "success" | "info"; title: string; detail: string };
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

const COPY: Record<View, { title: string; description: string }> = {
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

const DEFAULT_FILTERS: Filters = { retailerType: "all", supermarket: "", category: "", brand: "", query: "", stock: "all", period: 30 };
const SERIES_COLORS = ["#2563eb", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#64748b", "#14b8a6"];
const STORE_TYPES: Record<string, Exclude<RetailerType, "all">> = { lider: "supermarket", jumbo: "supermarket", "santa isabel": "supermarket", paris: "department_store", falabella: "department_store", ripley: "department_store", salcobrand: "pharmacy", "cruz verde": "pharmacy", "farmacias ahumada": "pharmacy", ahumada: "pharmacy" };
const integer = new Intl.NumberFormat("es-CL");
const compactFormatter = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function numeric(value: Numeric | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function number(value: Numeric | null | undefined) { return integer.format(numeric(value)); }
function compact(value: Numeric | null | undefined) { return compactFormatter.format(numeric(value)); }
function money(value: Numeric | null | undefined) { return currency.format(numeric(value)); }
function percentage(value: number | null | undefined, digits = 1) { if (value === null || value === undefined || !Number.isFinite(value)) return "—"; const normalized = Math.abs(value) < .005 ? 0 : value; return `${normalized > 0 ? "+" : ""}${normalized.toFixed(digits)}%`; }
function displayDate(value: string | null | undefined) { if (!value) return "Sin actualización"; return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function dateInput(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function retailerType(name: string): Exclude<RetailerType, "all"> { return STORE_TYPES[name.toLocaleLowerCase("es-CL")] ?? "department_store"; }
function productPrice(product: Product) { return numeric(product.offer_price) > 0 ? numeric(product.offer_price) : numeric(product.regular_price); }
function saveFile(url: string) { const anchor = document.createElement("a"); anchor.href = url; anchor.rel = "noreferrer"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }

export default function UnifiedPlatformApp() {
  const [view, setView] = useState<View>("overview");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [products, setProducts] = useState<ProductsPayload>({ products: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [pulse, setPulse] = useState<PulsePayload | null>(null);
  const [trend, setTrend] = useState<TrendPayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterPayload | null>(null);
  const [cascadeOptions, setCascadeOptions] = useState<CascadePayload | null>(null);
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
  const [competitiveKey, setCompetitiveKey] = useState("");
  const [basketKeys, setBasketKeys] = useState<string[]>([]);
  const [optimizer, setOptimizer] = useState({ price: 0, cost: 0, units: 100, elasticity: -1.2, margin: 20 });
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [exportStart, setExportStart] = useState(dateInput(new Date(Date.now() - 6 * 86400000)));
  const [exportEnd, setExportEnd] = useState(dateInput(new Date()));
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [generatingExport, setGeneratingExport] = useState(false);

  const loadCore = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingCore(true);
    try {
      const [dashboardResponse, pulseResponse, optionsResponse, exportsResponse] = await Promise.all([
        fetch(`/api/dashboard?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/weighted-price-pulse?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/daily-pricing-filter-options?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/data-exports?live=${Date.now()}`, { cache: "no-store" }),
      ]);
      const [dashboardData, pulseData, optionsData, exportsData] = await Promise.all([
        dashboardResponse.json() as Promise<DashboardPayload>,
        pulseResponse.json() as Promise<PulsePayload>,
        optionsResponse.json() as Promise<FilterPayload>,
        exportsResponse.json() as Promise<ExportPayload>,
      ]);
      if (!dashboardResponse.ok) throw new Error(dashboardData.error || "No fue posible cargar la plataforma");
      setDashboard(dashboardData);
      if (pulseResponse.ok) setPulse(pulseData);
      if (optionsResponse.ok) {
        setFilterOptions(optionsData);
        setActiveSeries((current) => current.length ? current : (optionsData.defaults ?? []).slice(0, 4));
      }
      if (exportsResponse.ok) setExportJobs(exportsData.exports ?? []);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando la plataforma");
    } finally {
      if (!quiet) setLoadingCore(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    const params = new URLSearchParams({ page: String(productPage), pageSize: "30", sort: productSort });
    if (filters.query.trim()) params.set("q", filters.query.trim());
    if (filters.retailerType !== "all") params.set("retailerType", filters.retailerType);
    if (filters.supermarket) params.set("supermarket", filters.supermarket);
    if (filters.category) params.set("category", filters.category);
    if (filters.brand) params.set("brand", filters.brand);
    if (filters.stock !== "all") params.set("stock", filters.stock);
    if (view === "promotions") params.set("offerOnly", "true");
    try {
      const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as ProductsPayload;
      if (!response.ok) throw new Error(data.error || "No fue posible cargar productos");
      setProducts(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando productos");
    } finally {
      setLoadingProducts(false);
    }
  }, [filters.query, filters.retailerType, filters.supermarket, filters.category, filters.brand, filters.stock, productPage, productSort, view]);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    const competitiveMode = view === "competitive";
    const params = new URLSearchParams({
      page: competitiveMode ? "1" : String(matchPage),
      pageSize: competitiveMode ? "1000" : "30",
      sort: competitiveMode ? "name_asc" : matchSort,
      minSavings: competitiveMode ? "0" : minSavings,
    });
    if (filters.query.trim()) params.set("q", filters.query.trim());
    if (filters.category) params.set("category", filters.category);
    if (filters.brand) params.set("brand", filters.brand);
    try {
      const response = await fetch(`/api/matches?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as MatchesPayload;
      if (!response.ok) throw new Error(data.error || "No fue posible cargar Price Matching");
      setMatches(data);
      setCompetitiveKey((current) => data.matches.some((item) => item.match_key === current) ? current : data.matches[0]?.match_key || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error cargando Price Matching");
    } finally {
      setLoadingMatches(false);
    }
  }, [filters.query, filters.category, filters.brand, matchPage, matchSort, minSavings, view]);

  const loadCascadeOptions = useCallback(async () => {
    const params = new URLSearchParams({ retailerType: filters.retailerType });
    if (filters.supermarket) params.set("supermarket", filters.supermarket);
    if (filters.category) params.set("category", filters.category);
    if (filters.brand) params.set("brand", filters.brand);
    try {
      const response = await fetch(`/api/cascading-filter-options?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as CascadePayload;
      if (!response.ok) throw new Error(data.error || "No fue posible actualizar los filtros");
      setCascadeOptions(data);
    } catch {
      setCascadeOptions(null);
    }
  }, [filters.retailerType, filters.supermarket, filters.category, filters.brand]);

  useEffect(() => {
    const initial = window.location.hash.replace("#", "") as View;
    if (initial && COPY[initial]) setView(initial);
    const onHashChange = () => { const next = window.location.hash.replace("#", "") as View; if (next && COPY[next]) setView(next); };
    window.addEventListener("hashchange", onHashChange);
    void loadCore();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 30000);
    return () => { window.removeEventListener("hashchange", onHashChange); window.clearInterval(interval); };
  }, [loadCore]);

  useEffect(() => { const timeout = window.setTimeout(() => void loadProducts(), 250); return () => window.clearTimeout(timeout); }, [loadProducts]);
  useEffect(() => { const timeout = window.setTimeout(() => void loadMatches(), 250); return () => window.clearTimeout(timeout); }, [loadMatches]);
  useEffect(() => { const timeout = window.setTimeout(() => void loadCascadeOptions(), 80); return () => window.clearTimeout(timeout); }, [loadCascadeOptions]);

  const seriesKey = activeSeries.join("|");
  useEffect(() => {
    if (!activeSeries.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(filters.period), live: String(Date.now()) });
    activeSeries.forEach((series) => params.append("series", series));
    fetch(`/api/daily-pricing-trend?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json() as TrendPayload; if (!response.ok) throw new Error(data.error || "No fue posible cargar la tendencia"); setTrend(data); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setNotice(error instanceof Error ? error.message : "Error cargando la tendencia"); });
    return () => controller.abort();
  }, [filters.period, seriesKey]);

  const summary = dashboard?.summary;
  const categoryOptions = filterOptions?.categories ?? [];
  const brandOptions = filterOptions?.brands ?? [];
  const chainFilterOptions = cascadeOptions?.chains ?? (dashboard?.supermarkets ?? []).filter((item) => filters.retailerType === "all" || retailerType(item.supermarket) === filters.retailerType).map((item) => ({ value: item.supermarket, products: numeric(item.products) }));
  const categoryFilterOptions = cascadeOptions?.categories ?? categoryOptions.map((item) => ({ value: item.label, products: item.products }));
  const brandFilterOptions = cascadeOptions?.brands ?? brandOptions.slice(0, 150).map((item) => ({ value: item.label, products: item.products }));
  const retailers = useMemo(() => (dashboard?.supermarkets ?? []).filter((item) => {
    if (filters.retailerType !== "all" && retailerType(item.supermarket) !== filters.retailerType) return false;
    if (filters.supermarket && item.supermarket !== filters.supermarket) return false;
    return true;
  }), [dashboard, filters.retailerType, filters.supermarket]);
  const categoryRows = useMemo(() => (dashboard?.categories ?? []).filter((item) => (filters.retailerType === "all" || retailerType(item.supermarket) === filters.retailerType) && (!filters.supermarket || item.supermarket === filters.supermarket) && (!filters.category || item.category === filters.category)), [dashboard, filters.retailerType, filters.supermarket, filters.category]);
  const pulseMap = useMemo(() => new Map((pulse?.data ?? []).map((item) => [item.supermarket.toLocaleLowerCase("es-CL"), item])), [pulse]);
  const weightedVariation = useMemo(() => {
    const ready = (pulse?.data ?? []).filter((item) => item.variationPct !== null);
    const total = ready.reduce((sum, item) => sum + Math.max(1, item.matchedSkus), 0);
    return total ? ready.reduce((sum, item) => sum + (item.variationPct ?? 0) * Math.max(1, item.matchedSkus), 0) / total : null;
  }, [pulse]);
  const stockCoverage = summary ? numeric(summary.in_stock_products) / Math.max(1, numeric(summary.total_products)) * 100 : 0;
  const crawlProgress = dashboard?.run?.tasks_total ? dashboard.run.tasks_completed / dashboard.run.tasks_total * 100 : 100;
  const marketAverage = retailers.length ? retailers.reduce((sum, item) => sum + numeric(item.average_price) * Math.max(1, numeric(item.products)), 0) / retailers.reduce((sum, item) => sum + Math.max(1, numeric(item.products)), 0) : 0;
  const selectedMatch = matches.matches.find((item) => item.match_key === competitiveKey) ?? matches.matches[0];
  const basketMatches = matches.matches.filter((item) => basketKeys.includes(item.match_key));

  useEffect(() => {
    if (!cascadeOptions) return;
    setFilters((current) => {
      if (current.supermarket && !cascadeOptions.chains.some((item) => item.value === current.supermarket)) return { ...current, supermarket: "", category: "", brand: "", stock: "all" };
      if (current.category && !cascadeOptions.categories.some((item) => item.value === current.category)) return { ...current, category: "", brand: "", stock: "all" };
      if (current.brand && !cascadeOptions.brands.some((item) => item.value === current.brand)) return { ...current, brand: "", stock: "all" };
      if (current.stock === "in" && cascadeOptions.stock.in <= 0) return { ...current, stock: "all" };
      if (current.stock === "out" && cascadeOptions.stock.out <= 0) return { ...current, stock: "all" };
      return current;
    });
  }, [cascadeOptions]);

  useEffect(() => {
    if (!selectedMatch || optimizer.price !== 0) return;
    const reference = numeric(selectedMatch.average_price);
    setOptimizer((current) => ({ ...current, price: reference, cost: reference * .65 }));
  }, [selectedMatch?.match_key, optimizer.price]);

  const trendChart = useMemo(() => {
    const series = (trend?.series ?? []).map((item, index) => {
      const first = item.points.find((point) => point.price !== null && point.price > 0)?.price ?? 1;
      return { ...item, color: SERIES_COLORS[index % SERIES_COLORS.length], points: item.points.map((point) => ({ ...point, index: point.price ? point.price / first * 100 : null })) };
    });
    const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
    const width = 1100;
    const height = 320;
    const margin = { top: 22, right: 24, bottom: 46, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = series.flatMap((item) => item.points.map((point) => point.index)).filter((value): value is number => value !== null && Number.isFinite(value));
    const minimum = Math.floor(Math.min(...values, 95) - 2);
    const maximum = Math.ceil(Math.max(...values, 105) + 2);
    const x = (index: number) => margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
    const y = (value: number) => margin.top + (maximum - value) / Math.max(1, maximum - minimum) * plotHeight;
    const maps = new Map(series.map((item) => [item.id, new Map(item.points.map((point) => [point.date, point.index]))]));
    const path = (id: string) => dates.map((date, index) => { const value = maps.get(id)?.get(date); return value === null || value === undefined ? null : { x: x(index), y: y(value) }; }).filter((point): point is { x: number; y: number } => point !== null).map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    return { series, dates, width, height, margin, minimum, maximum, x, y, path, currentObservations: trend?.currentDayObservations ?? 0 };
  }, [trend]);

  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];
    (pulse?.data ?? []).forEach((item) => {
      if ((item.variationPct ?? 0) > 1) items.push({ tone: "danger", title: `Alza relevante en ${item.supermarket}`, detail: `${percentage(item.variationPct)} en la canasta comparable.` });
      if ((item.variationPct ?? 0) < -1) items.push({ tone: "success", title: `Baja relevante en ${item.supermarket}`, detail: `${percentage(item.variationPct)} versus el día anterior.` });
    });
    if ((dashboard?.run?.tasks_failed ?? 0) > 0) items.push({ tone: "danger", title: "Tareas de scraping con error", detail: `${number(dashboard?.run?.tasks_failed)} tareas requieren revisión.` });
    if (matches.matches[0]) items.push({ tone: "info", title: "Brecha competitiva destacada", detail: `${matches.matches[0].canonical_name}: ${money(matches.matches[0].price_gap)} entre cadenas.` });
    return items;
  }, [pulse, dashboard, matches.matches]);

  function navigate(next: View) { setView(next); setMobileOpen(false); setProductPage(1); setMatchPage(1); window.history.replaceState(null, "", `#${next}`); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => {
      const next: Filters = { ...current, [key]: value };
      if (key === "retailerType") { next.supermarket = ""; next.category = ""; next.brand = ""; next.stock = "all"; }
      else if (key === "supermarket") { next.category = ""; next.brand = ""; next.stock = "all"; }
      else if (key === "category") { next.brand = ""; next.stock = "all"; }
      else if (key === "brand") { next.stock = "all"; }
      return next;
    });
    setProductPage(1);
    setMatchPage(1);
  }
  function clearFilters() { setFilters(DEFAULT_FILTERS); setProductPage(1); setMatchPage(1); }
  function addSeries(id: string) { if (!id) return; setActiveSeries((current) => current.includes(id) ? current : [...current, id].slice(0, filterOptions?.maxSeries ?? 8)); }

  async function createExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneratingExport(true);
    try {
      const response = await fetch("/api/data-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate: exportStart, endDate: exportEnd, supermarket: filters.supermarket || null, category: filters.category || null, productIds: [], format: exportFormat }) });
      const data = await response.json() as { job?: ExportJob; error?: string; detail?: string };
      if (!response.ok || !data.job) throw new Error(data.error || data.detail || "No fue posible generar el archivo");
      setExportJobs((current) => [data.job as ExportJob, ...current]);
      if (data.job.status === "completed" && data.job.result_url) saveFile(data.job.result_url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error generando el archivo");
    } finally {
      setGeneratingExport(false);
    }
  }

  const activeCopy = COPY[view];
  const groupLabel = MENU.find((group) => group.items.some((item) => item.view === view))?.label ?? "MGP Intelligence";

  const renderTrend = () => <div className={styles.trendWrap}>{trendChart.series.length ? <svg viewBox={`0 0 ${trendChart.width} ${trendChart.height}`} className={styles.trendSvg}>{[0, 1, 2, 3, 4].map((index) => { const value = trendChart.maximum - index * (trendChart.maximum - trendChart.minimum) / 4; const y = trendChart.y(value); return <g key={index}><line x1={trendChart.margin.left} x2={trendChart.width - trendChart.margin.right} y1={y} y2={y}/><text x={trendChart.margin.left - 10} y={y + 4}>{value.toFixed(0)}</text></g>; })}{trendChart.series.map((series) => <path key={series.id} d={trendChart.path(series.id)} stroke={series.color}/>)}{trendChart.dates.filter((_, index) => index === 0 || index === trendChart.dates.length - 1 || index % Math.max(1, Math.ceil(trendChart.dates.length / 6)) === 0).map((date) => { const index = trendChart.dates.indexOf(date); return <text key={date} className={styles.xLabel} x={trendChart.x(index)} y={trendChart.height - 12}>{new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "")}</text>; })}</svg> : <Empty label="Selecciona series con datos para construir la tendencia."/>}<footer>{trendChart.series.map((series) => <span key={series.id}><i style={{ background: series.color }}/>{series.label}</span>)}</footer></div>;

  const renderProducts = (promotions: boolean) => <section className={styles.workspace}><Toolbar><strong>{promotions ? "Promociones activas" : "Catálogo de productos"}</strong><select value={productSort} onChange={(event) => setProductSort(event.target.value)}><option value="updated_desc">Más recientes</option><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="name_asc">Nombre A–Z</option></select><span>{number(products.total)} resultados</span></Toolbar><article className={styles.card}>{loadingProducts ? <Loading/> : !products.products.length ? <Empty label="No hay productos con los filtros seleccionados."/> : <div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Cadena</th><th>Categoría</th><th>Precio</th>{promotions && <th>Ahorro</th>}<th>Stock</th><th>Actualización</th><th/></tr></thead><tbody>{products.products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.brand || `SKU ${product.external_id}`}</small></td><td><span className={styles.storeBadge}>{product.supermarket}</span></td><td>{product.smart_category || product.category || "Sin categoría"}</td><td><strong>{money(productPrice(product))}</strong>{numeric(product.regular_price) > productPrice(product) && <del>{money(product.regular_price)}</del>}</td>{promotions && <td><b className={styles.discount}>-{numeric(product.discount_pct).toFixed(0)}%</b></td>}<td><span className={product.in_stock ? styles.inStock : styles.outStock}>{product.in_stock ? "Disponible" : "Sin stock"}</span></td><td>{displayDate(product.observed_at)}</td><td><a href={product.url} target="_blank" rel="noreferrer">↗</a></td></tr>)}</tbody></table></div>}</article><Pagination page={productPage} totalPages={products.totalPages} setPage={setProductPage}/></section>;

  const renderView = () => {
    if (view === "overview") {
      const maxVariation = Math.max(2, ...(pulse?.data ?? []).map((item) => Math.abs(item.variationPct ?? 0)));
      return <><section className={styles.metrics}><Metric label="SKUs monitoreados" value={loadingCore ? "—" : number(summary?.total_products)} detail="Catálogo consolidado" tone="purple"/><Metric label="Retailers activos" value={loadingCore ? "—" : number(retailers.length)} detail="Fuentes visibles"/><Metric label="Observaciones del día" value={loadingCore ? "—" : number(trendChart.currentObservations)} detail="Actualización continua"/><Metric label="Variación ponderada" value={loadingCore ? "—" : percentage(weightedVariation)} detail="Mismos SKU vs. ayer" tone="green"/><Metric label="Matches detectados" value={loadingCore ? "—" : number(matches.total)} detail="Tres supermercados" tone="purple"/><Metric label="Cobertura de stock" value={loadingCore ? "—" : `${stockCoverage.toFixed(1)}%`} detail="SKU disponibles" tone="green"/></section><section className={styles.overviewGrid}><article className={`${styles.card} ${styles.variationCard}`}><CardHead title="Variación ponderada por cadena" subtitle="Mismos SKU contra el día anterior" action="Ver detalle" onAction={() => navigate("movements")}/><div className={styles.barChart}><div className={styles.barAxis}><span>+{maxVariation.toFixed(0)}%</span><span>0%</span><span>-{maxVariation.toFixed(0)}%</span></div><div className={styles.barGrid}><i/><i/><i/></div><div className={styles.barItems}>{retailers.map((retailer) => { const variation = pulseMap.get(retailer.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null; const height = variation === null ? 2 : Math.max(6, Math.abs(variation) / maxVariation * 46); return <div key={retailer.supermarket}><b>{variation === null ? "—" : percentage(variation)}</b><span><i className={variation === null ? styles.noBar : variation >= 0 ? styles.upBar : styles.downBar} style={{ height: `${height}%`, top: variation !== null && variation < 0 ? "50%" : `${50 - height}%` }}/></span><small>{retailer.supermarket.replace("Farmacias ", "")}</small></div>; })}</div></div></article><article className={`${styles.card} ${styles.matchSummary}`}><CardHead title="Price Matching" subtitle="Cobertura completa en tres cadenas" action="Abrir módulo" onAction={() => navigate("price-matching")}/><div className={styles.ringRow}><Ring value={compact(matches.total)} label="Matches" color="#2563eb"/><Ring value={`${Math.max(0, ...matches.matches.map((item) => numeric(item.savings_pct))).toFixed(0)}%`} label="Mayor ahorro" color="#10b981"/><Ring value={money(Math.max(0, ...matches.matches.map((item) => numeric(item.price_gap))))} label="Mayor brecha" color="#8b5cf6"/></div><div className={styles.miniTable}>{matches.matches.slice(0, 5).map((match) => <button key={match.match_key} onClick={() => navigate("price-matching")}><span><strong>{match.canonical_name}</strong><small>{match.canonical_brand || match.category || "Sin marca"}</small></span><b>{money(match.best_price)}</b><em>{money(match.price_gap)}</em></button>)}</div></article><aside className={styles.sideRail}><QuickAction title="Descarga de bases" copy="Exporta Excel o CSV con filtros." button="Configurar descarga" onClick={() => navigate("downloads")}/><QuickAction title="IA / Insights" copy="Prioriza brechas, alzas y oportunidades." button="Abrir Competitive AI" onClick={() => navigate("competitive")}/><article className={styles.card}><CardHead title="Estado del scraping" subtitle={`${crawlProgress.toFixed(0)}% del ciclo`}/><div className={styles.statusList}>{retailers.slice(0, 6).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><small>{displayDate(item.last_updated)}</small></div>)}</div></article></aside><article className={`${styles.card} ${styles.overviewTrend}`}><CardHead title="Evolución de precios promedio" subtitle="Índice base 100 por categoría y marca" action="Configurar series" onAction={() => navigate("movements")}/>{renderTrend()}</article></section></>;
    }

    if (view === "price-image") {
      const rows = retailers.map((item) => ({ ...item, index: marketAverage ? numeric(item.average_price) / marketAverage * 100 : 100 })).sort((a, b) => a.index - b.index);
      return <section className={styles.workspace}><section className={styles.metrics}><Metric label="Promedio mercado" value={money(marketAverage)} detail="Índice = 100"/><Metric label="Cadena más económica" value={rows[0]?.supermarket ?? "—"} detail={rows[0] ? `Índice ${rows[0].index.toFixed(1)}` : "Sin datos"} tone="green"/><Metric label="Mayor prima" value={rows.at(-1)?.supermarket ?? "—"} detail={rows.at(-1) ? `Índice ${rows.at(-1)!.index.toFixed(1)}` : "Sin datos"} tone="orange"/></section><article className={styles.card}><CardHead title="Índice de imagen de precio" subtitle="Menor a 100 = más económico que el mercado"/><div className={styles.indexList}>{rows.map((item) => <div key={item.supermarket}><header><strong>{item.supermarket}</strong><b>{item.index.toFixed(1)}</b></header><span><i className={item.index <= 100 ? styles.goodIndex : styles.highIndex} style={{ width: `${Math.min(100, Math.max(10, item.index / 1.25))}%` }}/><em style={{ left: "80%" }}/></span><footer>{money(item.average_price)} promedio · {number(item.products)} SKU</footer></div>)}</div></article></section>;
    }

    if (view === "price-matching") return <section className={styles.workspace}><Toolbar><select value={minSavings} onChange={(event) => setMinSavings(event.target.value)}><option value="0">Cualquier brecha</option><option value="5">Ahorro ≥ 5%</option><option value="10">Ahorro ≥ 10%</option><option value="20">Ahorro ≥ 20%</option></select><select value={matchSort} onChange={(event) => setMatchSort(event.target.value)}><option value="gap_desc">Mayor ahorro $</option><option value="savings_desc">Mayor ahorro %</option><option value="price_asc">Menor precio</option><option value="updated_desc">Más recientes</option></select><span>{number(matches.total)} matches validados</span></Toolbar>{loadingMatches ? <Loading label="Construyendo comparaciones…"/> : <div className={styles.matchCards}>{matches.matches.map((match) => <article key={match.match_key} className={styles.card}><header><div><span className={styles.confidence}>{match.match_method === "exact" ? "Match exacto" : "IA · alta confianza"}</span><h3>{match.canonical_name}</h3><p>{match.canonical_brand || "Marca no informada"} · {match.category || "Sin categoría"}</p></div><div><small>Ahorro potencial</small><strong>{money(match.price_gap)}</strong><b>{numeric(match.savings_pct).toFixed(1)}%</b></div></header><div className={styles.listingGrid}>{match.store_listings.map((listing) => <a key={listing.id} className={listing.supermarket === match.best_supermarket ? styles.winner : ""} href={listing.url} target="_blank" rel="noreferrer"><span>{listing.supermarket}</span><strong>{money(listing.price)}</strong><small>{listing.in_stock ? "Disponible" : "Sin stock"}</small></a>)}</div></article>)}</div>}<Pagination page={matchPage} totalPages={matches.totalPages} setPage={setMatchPage}/></section>;

    if (view === "competitive") {
      if (loadingMatches) return <Loading/>;
      if (!selectedMatch) return <Empty label="No existen productos comparables con los filtros actuales."/>;
      const midpoint = (numeric(selectedMatch.best_price) + numeric(selectedMatch.highest_price)) / 2;
      return <section className={styles.workspace}><Toolbar><select value={selectedMatch.match_key} onChange={(event) => setCompetitiveKey(event.target.value)}>{matches.matches.map((item) => <option key={item.match_key} value={item.match_key}>{item.canonical_name}</option>)}</select><span>{number(matches.total)} productos homologados · Analizando {selectedMatch.supermarkets} cadenas</span></Toolbar><section className={styles.metrics}><Metric label="Mejor precio" value={money(selectedMatch.best_price)} detail={selectedMatch.best_supermarket} tone="green"/><Metric label="Precio mercado" value={money(selectedMatch.average_price)} detail="Promedio homologado"/><Metric label="Mayor precio" value={money(selectedMatch.highest_price)} detail={`Brecha ${money(selectedMatch.price_gap)}`} tone="orange"/></section><div className={styles.twoColumn}><article className={styles.card}><CardHead title="Posición competitiva" subtitle={selectedMatch.canonical_name}/><div className={styles.positionScale}><span>{money(selectedMatch.best_price)}</span><span>{money(midpoint)}</span><span>{money(selectedMatch.highest_price)}</span><i/><b style={{ left: `${Math.min(95, Math.max(5, (numeric(selectedMatch.average_price) - numeric(selectedMatch.best_price)) / Math.max(1, numeric(selectedMatch.price_gap)) * 100))}%` }}/></div><div className={styles.listingRows}>{selectedMatch.store_listings.map((item) => <div key={item.id}><strong>{item.supermarket}</strong><span>{money(item.price)}</span><b>{item.supermarket === selectedMatch.best_supermarket ? "Líder" : numeric(item.price) > midpoint ? "Premium" : "Competitivo"}</b></div>)}</div></article><article className={styles.card}><CardHead title="Recomendación de IA" subtitle="Basada en el set competitivo actual"/><div className={styles.aiRecommendation}><i>✦</i><h3>{numeric(selectedMatch.savings_pct) >= 10 ? "Existe una brecha relevante de precio" : "El mercado presenta una dispersión controlada"}</h3><p>{numeric(selectedMatch.savings_pct) >= 10 ? `La diferencia alcanza ${numeric(selectedMatch.savings_pct).toFixed(1)}%. Evalúa un precio entre ${money(numeric(selectedMatch.best_price) * 1.02)} y ${money(selectedMatch.average_price)} para mejorar competitividad.` : `La brecha es de ${numeric(selectedMatch.savings_pct).toFixed(1)}%. Prioriza margen, disponibilidad y ejecución promocional antes de realizar un ajuste profundo.`}</p><ul><li>Verificar stock y vigencia de precios.</li><li>Comparar promociones y condiciones comerciales.</li><li>Monitorear nuevamente durante las próximas 24 horas.</li></ul></div></article></div></section>;
    }

    if (view === "optimizer") {
      if (!selectedMatch) return <Empty label="Selecciona productos homologados para usar el optimizador."/>;
      const floor = optimizer.cost / Math.max(.01, 1 - optimizer.margin / 100);
      const competitorPrices = selectedMatch.store_listings.map((item) => numeric(item.price)).filter((item) => item > 0);
      const recommended = Math.max(floor, Math.min(...competitorPrices) * .99);
      const delta = optimizer.price ? recommended / optimizer.price - 1 : 0;
      const projectedUnits = Math.max(0, optimizer.units * (1 + optimizer.elasticity * delta));
      const revenue = recommended * projectedUnits;
      const profit = (recommended - optimizer.cost) * projectedUnits;
      return <section className={styles.workspace}><Toolbar><select value={selectedMatch.match_key} onChange={(event) => { setCompetitiveKey(event.target.value); setOptimizer((current) => ({ ...current, price: 0, cost: 0 })); }}>{matches.matches.map((item) => <option key={item.match_key} value={item.match_key}>{item.canonical_name}</option>)}</select></Toolbar><div className={styles.optimizerGrid}><form className={styles.card}><CardHead title="Supuestos comerciales" subtitle="Ajusta los datos de tu negocio"/><div className={styles.formGrid}><NumberField label="Precio actual" value={optimizer.price} onChange={(price) => setOptimizer((current) => ({ ...current, price }))}/><NumberField label="Costo unitario" value={optimizer.cost} onChange={(cost) => setOptimizer((current) => ({ ...current, cost }))}/><NumberField label="Unidades mensuales" value={optimizer.units} onChange={(units) => setOptimizer((current) => ({ ...current, units }))}/><NumberField label="Elasticidad estimada" value={optimizer.elasticity} step="0.1" onChange={(elasticity) => setOptimizer((current) => ({ ...current, elasticity }))}/><NumberField label="Margen mínimo %" value={optimizer.margin} onChange={(margin) => setOptimizer((current) => ({ ...current, margin }))}/></div></form><article className={`${styles.card} ${styles.recommendationCard}`}><span>PRECIO RECOMENDADO</span><strong>{money(recommended)}</strong><p>{percentage(delta * 100)} respecto al precio actual</p><div><Metric label="Unidades proyectadas" value={number(projectedUnits)} detail="Estimación mensual" tone="green"/><Metric label="Ingresos" value={money(revenue)} detail="Proyección mensual"/><Metric label="Utilidad bruta" value={money(profit)} detail={`${((recommended - optimizer.cost) / Math.max(1, recommended) * 100).toFixed(1)}% margen`} tone="purple"/></div><small>La elasticidad es estimada mientras no exista histórico propio de ventas, costos y promociones.</small></article></div></section>;
    }

    if (view === "promotions") return renderProducts(true);
    if (view === "products") return renderProducts(false);

    if (view === "assortment") {
      const names = [...new Set(categoryRows.map((item) => item.category))];
      const totals = new Map<string, number>();
      categoryRows.forEach((item) => totals.set(item.category, (totals.get(item.category) ?? 0) + numeric(item.products)));
      const top = names.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).slice(0, 50);
      return <section className={styles.workspace}><article className={styles.card}><CardHead title="Matriz de surtido" subtitle="SKU observados por categoría y retailer"/><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th>{retailers.map((item) => <th key={item.supermarket}>{item.supermarket}</th>)}<th>Mayor brecha</th></tr></thead><tbody>{top.map((category) => { const values = retailers.map((retailer) => numeric(categoryRows.find((row) => row.category === category && row.supermarket === retailer.supermarket)?.products)); const maximum = Math.max(...values, 0); const minimum = Math.min(...values, 0); return <tr key={category}><td><strong>{category}</strong></td>{values.map((value, index) => <td key={`${category}-${index}`}><span className={styles.depthCell} style={{ opacity: .25 + (maximum ? value / maximum * .75 : 0) }}>{number(value)}</span></td>)}<td><b>{number(maximum - minimum)} SKU</b></td></tr>; })}</tbody></table></div></article></section>;
    }

    if (view === "movements") {
      const optionMap = new Map([...categoryOptions, ...brandOptions].map((item) => [item.id, item]));
      return <section className={styles.workspace}><section className={styles.pulseCards}>{(pulse?.data ?? []).map((item) => <article key={item.supermarket} className={styles.card}><span>{item.supermarket}</span><strong>{percentage(item.variationPct)}</strong><p>{item.matchedSkus ? `${number(item.matchedSkus)} SKU comparables` : "Base en construcción"}</p><small>{item.coveragePct?.toFixed(1) ?? "0,0"}% cobertura</small></article>)}</section><article className={styles.card}><CardHead title="Evolución diaria" subtitle="Agrega o elimina categorías y marcas"/><div className={styles.seriesPicker}><div><span>Series activas</span>{activeSeries.map((id) => <button key={id} onClick={() => setActiveSeries((current) => current.length > 1 ? current.filter((item) => item !== id) : current)}>{optionMap.get(id)?.label ?? id} ×</button>)}</div><select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Categoría</option>{categoryOptions.filter((item) => !activeSeries.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Marca</option>{brandOptions.filter((item) => !activeSeries.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>{renderTrend()}</article></section>;
    }

    if (view === "basket") {
      const stores = ["Lider", "Jumbo", "Santa Isabel"];
      const totals = new Map(stores.map((store) => [store, basketMatches.reduce((sum, match) => sum + numeric(match.store_listings.find((item) => item.supermarket === store)?.price), 0)]));
      const best = basketMatches.length ? Math.min(...[...totals.values()]) : 0;
      return <section className={styles.workspace}><div className={styles.basketGrid}><article className={styles.card}><CardHead title="Construye tu canasta" subtitle={`${basketMatches.length} productos seleccionados`}/><div className={styles.basketOptions}>{matches.matches.slice(0, 60).map((match) => <label key={match.match_key}><input type="checkbox" checked={basketKeys.includes(match.match_key)} onChange={() => setBasketKeys((current) => current.includes(match.match_key) ? current.filter((key) => key !== match.match_key) : [...current, match.match_key])}/><span><strong>{match.canonical_name}</strong><small>{match.canonical_brand || match.category || "Sin marca"}</small></span><b>{money(match.average_price)}</b></label>)}</div></article><article className={styles.card}><CardHead title="Resultado de la canasta" subtitle="Productos presentes en las tres cadenas"/><div className={styles.basketTotals}>{stores.map((store) => <div key={store} className={best > 0 && totals.get(store) === best ? styles.bestBasket : ""}><span>{store}</span><strong>{basketMatches.length ? money(totals.get(store)) : "—"}</strong><small>{basketMatches.length ? `${basketMatches.length} productos` : "Selecciona productos"}</small></div>)}</div></article></div></section>;
    }

    if (view === "categories") {
      const grouped = new Map<string, { total: number; retailers: Set<string> }>();
      categoryRows.forEach((item) => { const current = grouped.get(item.category) ?? { total: 0, retailers: new Set<string>() }; current.total += numeric(item.products); current.retailers.add(item.supermarket); grouped.set(item.category, current); });
      const rows = [...grouped.entries()].sort((a, b) => b[1].total - a[1].total);
      return <section className={styles.workspace}><div className={styles.categoryCards}>{rows.slice(0, 12).map(([name, item]) => <article key={name} className={styles.card}><span>{item.retailers.size} retailers</span><strong>{name}</strong><p>{number(item.total)} SKU monitoreados</p></article>)}</div><article className={styles.card}><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th><th>SKU</th><th>Retailers</th><th>Cobertura</th></tr></thead><tbody>{rows.map(([name, item]) => <tr key={name}><td><strong>{name}</strong></td><td>{number(item.total)}</td><td>{item.retailers.size}</td><td><span className={styles.coverageBar}><i style={{ width: `${Math.min(100, item.retailers.size / 9 * 100)}%` }}/></span></td></tr>)}</tbody></table></div></article></section>;
    }

    if (view === "retailers") return <section className={styles.workspace}><div className={styles.retailerCards}>{retailers.map((item) => { const storePulse = pulseMap.get(item.supermarket.toLocaleLowerCase("es-CL")); const type = retailerType(item.supermarket); return <article key={item.supermarket} className={styles.card}><header><span className={`${styles.retailerType} ${styles[type]}`}>{type === "supermarket" ? "Supermercado" : type === "pharmacy" ? "Farmacia" : "Multitienda"}</span><b><i/> Operativo</b></header><h3>{item.supermarket}</h3><div><strong>{number(item.products)}</strong><span>SKU monitoreados</span></div><dl><div><dt>Disponibles</dt><dd>{number(item.in_stock)}</dd></div><div><dt>Promociones</dt><dd>{number(item.offers)}</dd></div><div><dt>Precio promedio</dt><dd>{money(item.average_price)}</dd></div><div><dt>Variación</dt><dd>{percentage(storePulse?.variationPct)}</dd></div></dl><footer>Actualizado {displayDate(item.last_updated)}</footer></article>; })}</div></section>;

    if (view === "downloads") return <section className={styles.workspace}><div className={styles.downloadGrid}><form className={styles.card} onSubmit={createExport}><CardHead title="Configura la exportación" subtitle="Los filtros globales se aplican al archivo"/><div className={styles.exportForm}><label><span>Desde</span><input type="date" value={exportStart} max={exportEnd} onChange={(event) => setExportStart(event.target.value)} required/></label><label><span>Hasta</span><input type="date" value={exportEnd} min={exportStart} onChange={(event) => setExportEnd(event.target.value)} required/></label><label><span>Cadena</span><input value={filters.supermarket || "Todas las cadenas autorizadas"} readOnly/></label><label><span>Categoría</span><input value={filters.category || "Todas las categorías"} readOnly/></label></div><div className={styles.formatSelector}><button type="button" className={exportFormat === "xlsx" ? styles.selectedFormat : ""} onClick={() => setExportFormat("xlsx")}><strong>Excel</strong><small>Tablas dinámicas y análisis</small></button><button type="button" className={exportFormat === "csv" ? styles.selectedFormat : ""} onClick={() => setExportFormat("csv")}><strong>CSV</strong><small>Grandes volúmenes de datos</small></button></div><button className={styles.primaryButton} disabled={generatingExport}>{generatingExport ? "Generando…" : "Generar y descargar"}</button></form><aside className={styles.card}><CardHead title="Historial de descargas" subtitle={`${exportJobs.length} archivos recientes`}/><div className={styles.exportHistory}>{exportJobs.length ? exportJobs.map((job) => <article key={job.id}><div><b>{job.format.toUpperCase()}</b><span className={styles[job.status]}>{job.status === "completed" ? "Disponible" : job.status === "failed" ? "Fallida" : job.status === "processing" ? "Generando" : "En cola"}</span></div><strong>{job.parameters.supermarket || "Todas las cadenas"}</strong><p>{job.parameters.startDate} — {job.parameters.endDate}</p><small>{number(job.result_metadata?.rows ?? 0)} filas</small><button disabled={!job.result_url || job.status !== "completed"} onClick={() => job.result_url && saveFile(job.result_url)}>Descargar</button></article>) : <Empty label="Aún no existen archivos generados."/>}</div></aside></div></section>;

    if (view === "alerts") return <section className={styles.workspace}><div className={styles.alertGrid}>{alerts.length ? alerts.map((item, index) => <article key={`${item.title}-${index}`} className={`${styles.card} ${styles.alertCard}`}><i className={styles[item.tone]}/><div><span>{item.tone === "danger" ? "Prioridad alta" : item.tone === "success" ? "Movimiento favorable" : "Oportunidad"}</span><h3>{item.title}</h3><p>{item.detail}</p></div><button>Revisar →</button></article>) : <Empty label="No hay alertas activas con los filtros actuales."/>}</div></section>;

    if (view === "scraping") return <section className={styles.workspace}><section className={styles.metrics}><Metric label="Estado general" value={dashboard?.run?.status === "running" ? "Procesando" : "Operativo"} detail={`Run ${dashboard?.run?.id ?? "—"}`} tone="green"/><Metric label="Avance" value={`${crawlProgress.toFixed(0)}%`} detail={`${number(dashboard?.run?.tasks_completed)} tareas completas`}/><Metric label="Errores" value={number(dashboard?.run?.tasks_failed)} detail="Tareas fallidas" tone={numeric(dashboard?.run?.tasks_failed) ? "orange" : "green"}/><Metric label="Productos encontrados" value={number(dashboard?.run?.products_found)} detail="En la corrida actual" tone="purple"/></section><article className={styles.card}><CardHead title="Pipeline por retailer" subtitle="Última actividad registrada" action="Actualizar" onAction={() => void loadCore()}/><div className={styles.scrapeRows}>{(dashboard?.supermarkets ?? []).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><strong>{number(item.products)} SKU</strong><small>{displayDate(item.last_updated)}</small></div>)}</div></article></section>;

    return <section className={styles.workspace}><div className={styles.settingsGrid}><article className={styles.card}><CardHead title="Industria de la organización" subtitle="Controla el universo de datos visible"/><div className={styles.settingRow}><div><strong>{filterOptions?.industrySlug || "Todas las industrias"}</strong><p>La industria filtra dashboard, categorías, productos y exportaciones sin eliminar datos.</p></div><a href="/onboarding">Cambiar industria</a></div></article><article className={styles.card}><CardHead title="Preferencias del dashboard" subtitle="Configuración visual y de actualización"/><div className={styles.toggleRows}><label><span><strong>Actualización automática</strong><small>Recargar indicadores cada 30 segundos</small></span><input type="checkbox" defaultChecked/></label><label><span><strong>Mostrar datos en vivo</strong><small>Incluir el día en curso en las tendencias</small></span><input type="checkbox" defaultChecked/></label><label><span><strong>Alertas de scraping</strong><small>Destacar fuentes con errores o retrasos</small></span><input type="checkbox" defaultChecked/></label></div></article></div></section>;
  };

  return <div className={styles.app}>
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`}>
      <button className={styles.brand} onClick={() => navigate("overview")}><span className={styles.logo}><i/><i/><i/></span><span><strong>MGP Intelligence</strong><small>Commerce Decision Platform</small></span></button>
      <nav className={styles.navigation}>{MENU.map((group) => <section key={group.label} className={styles.navGroup}><h3>{group.label}</h3>{group.items.map((item) => <button key={item.view} className={view === item.view ? styles.activeNav : ""} onClick={() => navigate(item.view)}><i>{item.icon}</i><span>{item.label}</span>{item.view === "alerts" && alerts.length > 0 && <b>{alerts.length}</b>}</button>)}</section>)}</nav>
      <div className={styles.account}><div><span>MG</span><div><strong>MGP Team</strong><small>Administrador</small></div></div><hr/><small>Plan Enterprise</small><p>{number(summary?.total_products)} SKU monitoreados</p><div><i style={{ width: `${Math.min(100, stockCoverage)}%` }}/></div><strong><em/> Pipeline operativo</strong></div>
    </aside>

    <main className={styles.main}>
      <header className={styles.topbar}><button className={styles.menuButton} onClick={() => setMobileOpen((current) => !current)}>☰</button><div className={styles.pageTitle}><span>{groupLabel}</span><h1>{activeCopy.title}</h1><p>{activeCopy.description}</p></div><label className={styles.search}><span>⌕</span><input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Buscar productos, marcas o categorías…"/></label><button className={styles.headerControl}><span>▣</span> Últimos {filters.period} días</button><button className={styles.headerControl}><span>▱</span> {filterOptions?.industrySlug || "Todas las industrias"}</button></header>
      {notice && <div className={styles.notice}>{notice}<button onClick={() => setNotice("")}>×</button></div>}
      <section className={styles.filters}><div className={styles.typeFilter}><span>Tipo de retailer</span><div>{(["all", "supermarket", "department_store", "pharmacy"] as RetailerType[]).map((type) => <button key={type} className={filters.retailerType === type ? styles.selected : ""} onClick={() => updateFilter("retailerType", type)}>{type === "all" ? "Todos" : type === "supermarket" ? "Supermercados" : type === "department_store" ? "Multitiendas" : "Farmacias"}</button>)}</div></div><label><span>Cadena</span><select value={filters.supermarket} onChange={(event) => updateFilter("supermarket", event.target.value)}><option value="">Todas</option>{chainFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({number(item.products)})</option>)}</select></label><label><span>Categoría</span><select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}><option value="">Todas</option>{categoryFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({number(item.products)})</option>)}</select></label><label><span>Marca</span><select value={filters.brand} onChange={(event) => updateFilter("brand", event.target.value)}><option value="">Todas</option>{brandFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({number(item.products)})</option>)}</select></label><label><span>Stock</span><select value={filters.stock} onChange={(event) => updateFilter("stock", event.target.value as Filters["stock"])}><option value="all">Todo</option><option value="in" disabled={cascadeOptions ? cascadeOptions.stock.in <= 0 : false}>Disponible{cascadeOptions ? ` (${number(cascadeOptions.stock.in)})` : ""}</option><option value="out" disabled={cascadeOptions ? cascadeOptions.stock.out <= 0 : false}>Sin stock{cascadeOptions ? ` (${number(cascadeOptions.stock.out)})` : ""}</option></select></label><label><span>Período</span><select value={filters.period} onChange={(event) => updateFilter("period", Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label><button className={styles.clear} onClick={clearFilters}>⌫ Limpiar</button></section>
      {renderView()}
    </main>
  </div>;
}

function Metric({ label, value, detail, tone = "blue" }: { label: string; value: string; detail: string; tone?: "blue" | "green" | "purple" | "orange" }) { return <article className={styles.metric}><i className={`${styles.metricDot} ${styles[tone]}`}/><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>; }
function CardHead({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className={styles.cardHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button onClick={onAction}>{action} →</button>}</header>; }
function Toolbar({ children }: { children: React.ReactNode }) { return <div className={styles.toolbar}>{children}</div>; }
function Loading({ label = "Cargando datos…" }: { label?: string }) { return <div className={styles.loading}><i/>{label}</div>; }
function Empty({ label }: { label: string }) { return <div className={styles.empty}>{label}</div>; }
function Ring({ value, label, color }: { value: string; label: string; color: string }) { return <div className={styles.ringMetric}><div style={{ background: `conic-gradient(${color} 0 72%, #edf1f7 72%)` }}><span>{value}</span></div><strong>{label}</strong></div>; }
function QuickAction({ title, copy, button, onClick }: { title: string; copy: string; button: string; onClick: () => void }) { return <article className={`${styles.card} ${styles.quickAction}`}><h3>{title}</h3><p>{copy}</p><button onClick={onClick}>{button} →</button></article>; }
function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: React.Dispatch<React.SetStateAction<number>> }) { return <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Anterior</button><span>Página {page} de {Math.max(1, totalPages)}</span><button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente →</button></div>; }
function NumberField({ label, value, step = "1", onChange }: { label: string; value: number; step?: string; onChange: (value: number) => void }) { return <label><span>{label}</span><input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>; }
