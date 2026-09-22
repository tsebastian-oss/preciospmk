"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./UnifiedPlatformApp.module.css";
import ClickHouseLanding from "./ClickHouseLanding";
import ClickHouseInsightView, { type ClickHouseInsightMode } from "./ClickHouseInsightViewV2";
import AutomotiveIntelligence from "./AutomotiveIntelligence";
import BrandsVertical from "./BrandsVertical";
import B2BPricing from "./B2BPricing";
import ClickHouseOverview from "./ClickHouseOverview";
import AccountMenu from "./AccountMenu";
import CustomerAlerts from "./CustomerAlerts";
import { ActivationGuide, CommercialBanner, minimumPlanForView, requiredModuleForView, type CommercialAccountPayload } from "./CommercialExperience";
import CategoryIntelligence from "./CategoryIntelligence";
import ClickHouseDownloads from "./ClickHouseDownloads";
import UsageAnalyticsPanel from "./UsageAnalyticsPanel";

type Numeric = number | string;
type View = "overview" | "category-intelligence" | "downloads" | "alerts" | "scraping" | "settings" | "usage" | "price-evolution" | "retailer-benchmark" | "market-coverage" | "price-gaps" | "price-alerts" | "products" | "data-status" | "automotive" | "brands" | "piwen" | "pricing-b2b";
type RetailerType = "all" | "supermarket" | "department_store" | "pharmacy" | "home_improvement";
type Filters = { retailerType: RetailerType; supermarket: string; category: string; brand: string; query: string; stock: "all" | "in" | "out"; period: number };
type Summary = { total_products: Numeric; in_stock_products: Numeric; offers: Numeric; supermarkets: Numeric; average_price: Numeric; total_savings: Numeric; last_updated: string | null };
type RetailerSummary = { supermarket: string; products: Numeric; in_stock: Numeric; offers: Numeric; average_price: Numeric; average_discount: Numeric; last_updated: string | null };
type CategorySummary = { supermarket: string; category: string; products: Numeric };
type CrawlRun = { id: number; status: string; tasks_total: number; tasks_completed: number; tasks_failed: number; products_found: number };
type Product = { id: string; supermarket: string; external_id: string; name: string; brand: string | null; category: string | null; smart_category?: string | null; url: string; regular_price: Numeric | null; offer_price: Numeric; in_stock: boolean; observed_at: string; discount_pct: Numeric };
type PharmacyCoverageRow = {
  retailer: string;
  runId: number | null;
  runStatus: string;
  status: string;
  discoveredUrls: number;
  capturedUrls: number;
  capturedProducts: number;
  missingUrls: number;
  coveragePct: number | null;
  taskProgressPct: number | null;
  discoveryComplete: boolean;
  queuedTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  startedAt: string | null;
  finishedAt: string | null;
};
type PharmacyCoveragePayload = {
  checkedAt?: string | null;
  parallel?: boolean;
  retailers: PharmacyCoverageRow[];
  unavailable?: boolean;
  error?: string;
};
type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; categories: CategorySummary[]; run: CrawlRun | null; topOffers: Product[]; error?: string };
type ProductsPayload = { products: Product[]; page: number; pageSize: number; total: number; totalPages: number; error?: string };
type StorePulse = { supermarket: string; variationPct: number | null; matchedSkus: number; currentSkus: number; coveragePct: number | null; status: "ready" | "building"; latestObservationAt: string | null };
type PulsePayload = { data: StorePulse[]; latestObservationAt: string | null; error?: string };
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
  { label: "Inicio", items: [
    { view: "overview", label: "Asistente & Inicio", icon: "✦" },
  ] },
  { label: "Análisis de precios", items: [
    { view: "price-evolution", label: "Evolución de precios", icon: "⌁" },
    { view: "price-gaps", label: "Brechas de precio", icon: "⇄" },
    { view: "price-alerts", label: "Movimientos y alertas", icon: "!" },
  ] },
  { label: "Análisis de mercado", items: [
    { view: "category-intelligence", label: "Análisis de categorías", icon: "◒" },
    { view: "products", label: "Productos", icon: "□" },
  ] },
  { label: "Automotriz", items: [
    { view: "automotive", label: "Mercado automotriz", icon: "◇" },
  ] },
  { label: "Brands", items: [
    { view: "brands", label: "Marcas", icon: "◆" },
    { view: "piwen", label: "Piwén", icon: "◈" },
  ] },
  { label: "Pricing B2B", items: [
    { view: "pricing-b2b", label: "Courier & Logistics", icon: "◫" },
  ] },
  { label: "Datos y operación", items: [
    { view: "downloads", label: "Descarga de bases", icon: "↓" },
    { view: "data-status", label: "Estado de datos", icon: "↻" },
    { view: "settings", label: "Configuración", icon: "⚙" },
  ] },
];

const COPY: Record<View, { title: string; description: string }> = {
  "pricing-b2b": { title: "Pricing B2B", description: "Compara precios B2B normalizados por ruta, peso y distancia junto al contexto de compras públicas." },
  brands: { title: "Brand & Retail Intelligence", description: "Descubre dónde se vende una marca y monitorea catálogo, precios, sellers y presencia digital." },
  piwen: { title: "Piwén Pricing Intelligence", description: "Demo dedicada para monitorear paridad de canales, benchmark por kilo, promociones y arquitectura de precios de Piwén." },
  automotive: { title: "Mercado automotriz", description: "Marcas, modelos, versiones, bonos y precios desde concesionarios chilenos." },
  "price-evolution": { title: "Evolución de precios", description: "Histórico de precios por marca, producto y retailer desde ClickHouse." },
  "retailer-benchmark": { title: "Benchmark retailers", description: "Compara mediana y rango de precios entre retailers." },
  "market-coverage": { title: "Cobertura de mercado", description: "Profundidad y disponibilidad del catálogo monitoreado." },
  "price-gaps": { title: "Brechas de precio", description: "Diferencias de precio entre retailers sobre universos comparables." },
  "price-alerts": { title: "Movimientos y alertas", description: "Alzas y bajas diarias detectadas en ClickHouse." },
  products: { title: "Productos", description: "Explora precios actuales por marca y producto directamente desde ClickHouse." },
  "data-status": { title: "Estado de datos", description: "Freshness y actividad de las fuentes monitoreadas." },
  overview: { title: "Resumen Ejecutivo", description: "Panorama general del monitoreo de precios, surtido y actividad competitiva en Chile." },
  "category-intelligence": { title: "Análisis de Categorías", description: "Explora visualmente precios, surtido, promociones, retailers y productos de cada categoría usando ClickHouse." },
  downloads: { title: "Descarga de bases", description: "Genera archivos Excel o CSV con los filtros y permisos de tu organización." },
  alerts: { title: "Alertas", description: "Prioriza alzas, bajas, brechas, quiebres y problemas de captura." },
  scraping: { title: "Scraping Status", description: "Controla la salud del pipeline, avance y actualización por retailer." },
  settings: { title: "Configuración", description: "Administra industria, preferencias visuales y comportamiento del dashboard." },
  usage: { title: "Uso de la plataforma", description: "Revisa sesiones, tiempo activo, módulos utilizados, consultas IA y descargas por usuario y cliente." },
};

const ADMIN_MENU: MenuGroup = { label: "Administración", items: [{ view: "usage", label: "Uso de la plataforma", icon: "◎" }] };

const CLICKHOUSE_INSIGHT_VIEWS = new Set<View>(["price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","products","data-status"]);
const LAZY_VISIBLE_VIEWS = new Set<View>(["overview","price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","category-intelligence","products","downloads","data-status","settings","automotive","brands","piwen","pricing-b2b"]);
const DARK_VISIBLE_VIEWS = new Set<View>(["overview","price-evolution","retailer-benchmark","market-coverage","price-gaps","price-alerts","category-intelligence","products","downloads","data-status","automotive","brands","piwen","pricing-b2b"]);
function isClickHouseInsightView(value: View): value is ClickHouseInsightMode { return CLICKHOUSE_INSIGHT_VIEWS.has(value); }

const DEFAULT_FILTERS: Filters = { retailerType: "all", supermarket: "", category: "", brand: "", query: "", stock: "all", period: 30 };
const STORE_TYPES: Record<string, Exclude<RetailerType, "all">> = { lider: "supermarket", jumbo: "supermarket", "santa isabel": "supermarket", paris: "department_store", falabella: "department_store", ripley: "department_store", salcobrand: "pharmacy", "cruz verde": "pharmacy", "farmacias ahumada": "pharmacy", ahumada: "pharmacy", easy: "home_improvement", sodimac: "home_improvement" };
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
  const [pharmacyCoverage, setPharmacyCoverage] = useState<PharmacyCoveragePayload | null>(null);
  const [loadingPharmacyCoverage, setLoadingPharmacyCoverage] = useState(false);
  const [products, setProducts] = useState<ProductsPayload>({ products: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [pulse, setPulse] = useState<PulsePayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterPayload | null>(null);
  const [cascadeOptions, setCascadeOptions] = useState<CascadePayload | null>(null);
  const [productPage, setProductPage] = useState(1);
  const [productSort, setProductSort] = useState("updated_desc");
  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [notice, setNotice] = useState("");
  const [commercialAccount, setCommercialAccount] = useState<CommercialAccountPayload | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [exportStart, setExportStart] = useState(dateInput(new Date(Date.now() - 6 * 86400000)));
  const [exportEnd, setExportEnd] = useState(dateInput(new Date()));
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [generatingExport, setGeneratingExport] = useState(false);
  const [isSaasAdmin, setIsSaasAdmin] = useState(false);

  const loadCore = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingCore(true);
    try {
      const [dashboardResponse, pulseResponse, optionsResponse] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/weighted-price-pulse"),
        fetch("/api/daily-pricing-filter-options"),
      ]);
      const [dashboardData, pulseData, optionsData] = await Promise.all([
        dashboardResponse.json() as Promise<DashboardPayload>,
        pulseResponse.json() as Promise<PulsePayload>,
        optionsResponse.json() as Promise<FilterPayload>,
      ]);
      if (!dashboardResponse.ok) throw new Error(dashboardData.error || "No fue posible cargar la plataforma");
      setDashboard(dashboardData);
      setLoadingPharmacyCoverage(true);
      void fetch(`/api/pharmacy-coverage?live=${Date.now()}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json() as PharmacyCoveragePayload;
          if (response.ok) setPharmacyCoverage(data);
          else setPharmacyCoverage((current) => ({ ...(current ?? { retailers: [] }), unavailable: true, error: data.error || "Cobertura temporalmente no disponible" }));
        })
        .catch(() => setPharmacyCoverage((current) => ({ ...(current ?? { retailers: [] }), unavailable: true, error: "Cobertura temporalmente no disponible" })))
        .finally(() => setLoadingPharmacyCoverage(false));
      if (pulseResponse.ok) setPulse(pulseData);
      if (optionsResponse.ok) {
        setFilterOptions(optionsData);
      }
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
    if (false) params.set("offerOnly", "true");
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
    let active = true;
    fetch("/api/enterprise/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ isSaasAdmin?: boolean }> : null)
      .then((data) => {
        if (!active) return;
        const allowed = Boolean(data?.isSaasAdmin);
        setIsSaasAdmin(allowed);
        if (!allowed && window.location.hash === "#usage") {
          setView("overview");
          window.history.replaceState(null, "", "#overview");
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
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
  }, [loadCore, view]);

  useEffect(() => {
    return; // global Promotions module retired
    const timeout = window.setTimeout(() => void loadProducts(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadProducts, view]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/enterprise/account", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CommercialAccountPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar el plan");
        if (!cancelled) setCommercialAccount(payload);
      })
      .catch(() => { if (!cancelled) setCommercialAccount(null); });
    return () => { cancelled = true; };
  }, []);

  const enabledModules = useMemo(() => new Set(commercialAccount?.organization?.modules ?? []), [commercialAccount]);
  const exportLimit = Number(commercialAccount?.organization?.commercial?.limits?.exports_per_month ?? commercialAccount?.organization?.limits?.exports_per_month ?? 0);
  const exportsUsed = Number(commercialAccount?.organization?.commercial?.usage?.exportsThisMonth ?? 0);
  const exportLimitReached = exportLimit > 0 && exportsUsed >= exportLimit;
  function viewAllowed(next: View) {
    if (!commercialAccount) return true;
    const required = requiredModuleForView(next);
    return !required || enabledModules.has(required);
  }

  useEffect(() => {
    if (view !== "downloads") return;
    const controller = new AbortController();
    fetch("/api/data-exports", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as ExportPayload;
        if (response.ok) setExportJobs(data.exports ?? []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotice("No fue posible cargar las exportaciones");
      });
    return () => controller.abort();
  }, [view]);

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
  const pulseMap = useMemo(() => new Map((pulse?.data ?? []).map((item) => [item.supermarket.toLocaleLowerCase("es-CL"), item])), [pulse]);
  const weightedVariation = useMemo(() => {
    const ready = (pulse?.data ?? []).filter((item) => item.variationPct !== null);
    const total = ready.reduce((sum, item) => sum + Math.max(1, item.matchedSkus), 0);
    return total ? ready.reduce((sum, item) => sum + (item.variationPct ?? 0) * Math.max(1, item.matchedSkus), 0) / total : null;
  }, [pulse]);
  const stockCoverage = summary ? numeric(summary.in_stock_products) / Math.max(1, numeric(summary.total_products)) * 100 : 0;
  const crawlProgress = dashboard?.run?.tasks_total ? dashboard.run.tasks_completed / dashboard.run.tasks_total * 100 : 100;

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

  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];
    (pulse?.data ?? []).forEach((item) => {
      if ((item.variationPct ?? 0) > 1) items.push({ tone: "danger", title: `Alza relevante en ${item.supermarket}`, detail: `${percentage(item.variationPct)} en la canasta comparable.` });
      if ((item.variationPct ?? 0) < -1) items.push({ tone: "success", title: `Baja relevante en ${item.supermarket}`, detail: `${percentage(item.variationPct)} versus el día anterior.` });
    });
    if ((dashboard?.run?.tasks_failed ?? 0) > 0) items.push({ tone: "danger", title: "Tareas de scraping con error", detail: `${number(dashboard?.run?.tasks_failed)} tareas requieren revisión.` });
    return items;
  }, [pulse, dashboard]);

  function navigate(next: View) { if (!viewAllowed(next)) { setNotice(`Este módulo requiere ${minimumPlanForView(next)} o superior.`); return; } setView(next); setMobileOpen(false); setProductPage(1); window.history.replaceState(null, "", `#${next}`); window.scrollTo({ top: 0, behavior: "smooth" }); }
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

  }
  function clearFilters() { setFilters(DEFAULT_FILTERS); setProductPage(1); }

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

  const visibleMenu = isSaasAdmin ? [...MENU, ADMIN_MENU] : MENU;
  useEffect(() => {
    if (!commercialAccount) return;
    const required = requiredModuleForView(view);
    if (required && !enabledModules.has(required)) {
      setView("overview");
      window.history.replaceState(null, "", "#overview");
      setNotice(`Este módulo requiere ${minimumPlanForView(view)} o superior. Volvimos al Resumen Ejecutivo.`);
    }
  }, [commercialAccount, enabledModules, view]);

  const activeCopy = COPY[view];
  const groupLabel = visibleMenu.find((group) => group.items.some((item) => item.view === view))?.label ?? "MGP Super Precios";

  const renderProducts = (promotions: boolean) => <section className={styles.workspace}><Toolbar><strong>{promotions ? "Promociones activas" : "Catálogo de productos"}</strong><select value={productSort} onChange={(event) => setProductSort(event.target.value)}><option value="updated_desc">Más recientes</option><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="name_asc">Nombre A–Z</option></select><span>{number(products.total)} resultados</span></Toolbar><article className={styles.card}>{loadingProducts ? <Loading/> : !products.products.length ? <Empty label="No hay productos con los filtros seleccionados."/> : <div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Cadena</th><th>Categoría</th><th>Precio</th>{promotions && <th>Ahorro</th>}<th>Stock</th><th>Actualización</th><th/></tr></thead><tbody>{products.products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.brand || `SKU ${product.external_id}`}</small></td><td><span className={styles.storeBadge}>{product.supermarket}</span></td><td>{product.smart_category || product.category || "Sin categoría"}</td><td><strong>{money(productPrice(product))}</strong>{numeric(product.regular_price) > productPrice(product) && <del>{money(product.regular_price)}</del>}</td>{promotions && <td><b className={styles.discount}>-{numeric(product.discount_pct).toFixed(0)}%</b></td>}<td><span className={product.in_stock ? styles.inStock : styles.outStock}>{product.in_stock ? "Disponible" : "Sin stock"}</span></td><td>{displayDate(product.observed_at)}</td><td><a href={product.url} target="_blank" rel="noreferrer">↗</a></td></tr>)}</tbody></table></div>}</article><Pagination page={productPage} totalPages={products.totalPages} setPage={setProductPage}/></section>;

  const renderView = () => {
    if (view === "usage") return isSaasAdmin ? <UsageAnalyticsPanel /> : <Empty label="Este módulo está disponible solo para administradores SaaS."/>;

    if (view === "overview") {
      const maxVariation = Math.max(2, ...(pulse?.data ?? []).map((item) => Math.abs(item.variationPct ?? 0)));
      return <><ActivationGuide currentView={view} onNavigate={navigate} account={commercialAccount}/><section className={styles.metrics}><Metric label="SKUs monitoreados" value={loadingCore ? "—" : number(summary?.total_products)} detail="Catálogo consolidado" tone="purple"/><Metric label="Retailers activos" value={loadingCore ? "—" : number(retailers.length)} detail="Fuentes visibles"/><Metric label="Promociones activas" value={loadingCore ? "—" : number(summary?.offers)} detail="Ofertas vigentes" tone="orange"/><Metric label="Variación ponderada" value={loadingCore ? "—" : percentage(weightedVariation)} detail="Mismos SKU vs. ayer" tone="green"/><Metric label="Cobertura de stock" value={loadingCore ? "—" : `${stockCoverage.toFixed(1)}%`} detail="SKU disponibles" tone="green"/></section><section className={styles.overviewGrid}><article className={`${styles.card} ${styles.variationCard}`}><CardHead title="Variación ponderada por cadena" subtitle="Mismos SKU contra el día anterior"/><div className={styles.barChart}><div className={styles.barAxis}><span>+{maxVariation.toFixed(0)}%</span><span>0%</span><span>-{maxVariation.toFixed(0)}%</span></div><div className={styles.barGrid}><i/><i/><i/></div><div className={styles.barItems}>{retailers.map((retailer) => { const variation = pulseMap.get(retailer.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null; const height = variation === null ? 2 : Math.max(6, Math.abs(variation) / maxVariation * 46); return <div key={retailer.supermarket}><b>{variation === null ? "—" : percentage(variation)}</b><span><i className={variation === null ? styles.noBar : variation >= 0 ? styles.upBar : styles.downBar} style={{ height: `${height}%`, top: variation !== null && variation < 0 ? "50%" : `${50 - height}%` }}/></span><small>{retailer.supermarket.replace("Farmacias ", "")}</small></div>; })}</div></div></article><aside className={styles.sideRail}><QuickAction title="Descarga de bases" copy="Exporta Excel o CSV con filtros." button="Configurar descarga" onClick={() => navigate("downloads")}/><QuickAction title="Category Intelligence" copy="Conversa con tus datos diarios usando OpenAI Sol." button="Abrir módulo" onClick={() => navigate("category-intelligence")}/><article className={styles.card}><CardHead title="Estado del scraping" subtitle={`${crawlProgress.toFixed(0)}% del ciclo`}/><div className={styles.statusList}>{retailers.slice(0, 6).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><small>{displayDate(item.last_updated)}</small></div>)}</div></article></aside></section></>;
    }

    if (view === "category-intelligence") return <CategoryIntelligence filters={{ supermarket: filters.supermarket, period: filters.period }}/>;

    if (view === "downloads") return <ClickHouseDownloads filters={{ supermarket: filters.supermarket, category: filters.category, brand: filters.brand }}/>;

    if (view === "alerts") return <CustomerAlerts/>;

    if (view === "scraping") {
      const pharmacyRows = pharmacyCoverage?.retailers ?? [];
      const measuredCoverage = pharmacyRows.filter((item) => item.coveragePct !== null);
      const averageCoverage = measuredCoverage.length
        ? measuredCoverage.reduce((sum, item) => sum + (item.coveragePct ?? 0), 0) / measuredCoverage.length
        : null;
      const runningPharmacies = pharmacyRows.filter((item) => item.runStatus === "running").length;
      const pharmacyErrors = pharmacyRows.reduce((sum, item) => sum + numeric(item.failedTasks), 0);
      const pharmacyMissing = pharmacyRows.reduce((sum, item) => sum + numeric(item.missingUrls), 0);
      return <section className={`${styles.workspace} pharmacyStatusWorkspace`}>
        <div className="pharmacyStatusIntro">
          <div><span>MONITOREO DE CATÁLOGO</span><h2>Estado de captura por farmacia</h2><p>Las tres cadenas corren de forma independiente. La cobertura es provisional mientras el descubrimiento siga abierto.</p></div>
          <button onClick={() => void loadCore()} disabled={loadingCore || loadingPharmacyCoverage}>{loadingCore || loadingPharmacyCoverage ? "Actualizando…" : "Actualizar datos"}</button>
        </div>

        <section className="pharmacyKpiGrid">
          <article><span>Farmacias activas</span><strong>{pharmacyRows.length || 3}</strong><small>{runningPharmacies ? runningPharmacies + " farmacias corriendo en paralelo" : "Monitoreo independiente"}</small></article>
          <article><span>Cobertura promedio</span><strong>{averageCoverage === null ? "Midiendo" : averageCoverage.toFixed(2) + "%"}</strong><small>Capturadas / descubiertas</small></article>
          <article><span>URLs pendientes</span><strong>{number(pharmacyMissing)}</strong><small>{pharmacyRows.some((item) => !item.discoveryComplete) ? "Puede variar mientras descubre" : "Brecha final identificada"}</small></article>
          <article><span>Tareas fallidas</span><strong>{number(pharmacyErrors)}</strong><small>{pharmacyErrors ? "Requieren revisión" : "Sin errores registrados"}</small></article>
        </section>

        <article className={`${styles.card} pharmacyCoveragePanel`}>
          <header className="pharmacyPanelHeader"><div><h2>Cobertura de catálogo · Farmacias</h2><p>Avance real por cadena, run y catálogo descubierto.</p></div><span>{pharmacyCoverage?.checkedAt ? "Actualizado " + displayDate(pharmacyCoverage.checkedAt) : "Actualizando"}</span></header>
          {loadingPharmacyCoverage && !pharmacyRows.length ? <div className="pharmacyCoverageLoading">Midiendo cobertura de las tres farmacias…</div> : pharmacyCoverage?.unavailable && !pharmacyRows.length ? <div className="pharmacyCoverageUnavailable">La cobertura no respondió en esta actualización. El resto del dashboard sigue operativo.</div> : <div className="pharmacyCoverageCards">{pharmacyRows.map((item) => {
            const progress = item.taskProgressPct ?? 0;
            const statusLabel = item.runStatus === "running" ? (item.discoveryComplete ? "Capturando" : "Descubriendo") : item.runStatus === "completed" || item.runStatus === "completed_with_errors" ? "Finalizado" : item.runStatus || "Sin iniciar";
            return <article key={item.retailer} className="pharmacyCoverageCard">
              <header><div><span className="pharmacyStatusDot"/><strong>{item.retailer}</strong></div><b data-status={item.runStatus}>{statusLabel}</b></header>
              <div className="pharmacyCoverageValue"><strong>{item.coveragePct === null ? "—" : item.coveragePct.toFixed(2) + "%"}</strong><span>Cobertura</span></div>
              <div className="pharmacyProgressTrack"><i style={{ width: Math.min(100, Math.max(0, progress)) + "%" }}/></div>
              <small className="pharmacyProgressLabel">{item.discoveryComplete ? "Descubrimiento completo" : "Avance de tareas " + (item.taskProgressPct === null ? "—" : item.taskProgressPct.toFixed(1) + "%")}</small>
              <dl><div><dt>Capturadas</dt><dd>{number(item.capturedUrls)}</dd></div><div><dt>Descubiertas</dt><dd>{number(item.discoveredUrls)}</dd></div><div><dt>Faltantes</dt><dd>{number(item.missingUrls)}</dd></div><div><dt>Fallidas</dt><dd>{number(item.failedTasks)}</dd></div></dl>
              <footer>Run {item.runId ?? "—"} · {item.queuedTasks ? number(item.queuedTasks) + " en cola" : "cola limpia"}</footer>
            </article>;
          })}</div>}
        </article>

        <article className={`${styles.card} pharmacyPipelinePanel`}>
          <header className="pharmacyPanelHeader"><div><h2>Pipeline por retailer</h2><p>Última actividad y tamaño del catálogo visible.</p></div></header>
          <div className="pharmacyPipelineRows">{(dashboard?.supermarkets ?? []).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><strong>{number(item.products)} SKU</strong><small>{displayDate(item.last_updated)}</small></div>)}</div>
        </article>
      </section>;
    }

    return <section className={styles.workspace}><div className={styles.settingsGrid}><article className={styles.card}><CardHead title="Industria de la organización" subtitle="Controla el universo de datos visible"/><div className={styles.settingRow}><div><strong>{filterOptions?.industrySlug || "Todas las industrias"}</strong><p>La industria filtra dashboard, categorías, productos y exportaciones sin eliminar datos.</p></div><a href="/onboarding">Cambiar industria</a></div></article><article className={styles.card}><CardHead title="Cuenta y plan" subtitle="Configuración que sí queda guardada"/><div className={styles.settingRow}><div><strong>Alcance y permisos</strong><p>Administra industria y retailers desde onboarding; revisa usuarios, uso y plan desde Mi cuenta.</p></div><a href="/cuenta">Abrir Mi cuenta</a></div><div className={styles.settingRow}><div><strong>Industria y retailers</strong><p>Los cambios recalculan automáticamente el dashboard dentro del alcance autorizado.</p></div><a href="/onboarding?change=1">Configurar alcance</a></div></article></div></section>;
  };

  return <div className={`${styles.app} ${DARK_VISIBLE_VIEWS.has(view) ? styles.clickHouseMode : ""}`}>
    <button
      type="button"
      className={styles.globalMobileMenuButton}
      aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
      aria-expanded={mobileOpen}
      onClick={() => setMobileOpen((current) => !current)}
    ><span/><span/><span/></button>
    {mobileOpen && <button type="button" className={styles.mobileMenuBackdrop} aria-label="Cerrar menú" onClick={() => setMobileOpen(false)}/>}
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`}>
      <button className={styles.brand} onClick={() => navigate("overview")}><span className={styles.logo}><i/><i/><i/></span><span><strong>MGP Super Precios</strong><small>Retail Intelligence Platform</small></span></button>
      <nav className={styles.navigation}>{visibleMenu.map((group) => <section key={group.label} className={styles.navGroup}><h3>{group.label}</h3>{group.items.map((item) => { const allowed = viewAllowed(item.view); const minimumPlan = minimumPlanForView(item.view); return <button key={item.view} className={view === item.view ? styles.activeNav : ""} onClick={() => navigate(item.view)} disabled={!allowed} title={allowed ? item.label : `Disponible desde ${minimumPlan}`}><i>{item.icon}</i><span>{item.label}</span>{!allowed && <small className={styles.planLock}>{minimumPlan}</small>}{item.view === "alerts" && alerts.length > 0 && allowed && <b>{alerts.length}</b>}</button>; })}</section>)}</nav>
      <AccountMenu/>
    </aside>

    <main className={`${styles.main} ${DARK_VISIBLE_VIEWS.has(view) ? styles.clickHouseMain : ""}`}>
      {view === "overview" ? <ClickHouseLanding/> : isClickHouseInsightView(view) ? <ClickHouseInsightView key={view} mode={view}/> : view === "category-intelligence" ? <CategoryIntelligence/> : view === "automotive" ? <AutomotiveIntelligence/> : view === "piwen" ? <BrandsVertical initialBrand="piwen"/> : view === "brands" ? <BrandsVertical/> : view === "pricing-b2b" ? <B2BPricing/> : <>
      <header className={styles.topbar}><button className={styles.menuButton} onClick={() => setMobileOpen((current) => !current)}>☰</button><div className={styles.pageTitle}><span>{groupLabel}</span><h1>{activeCopy.title}</h1><p>{activeCopy.description}</p></div>{view !== "usage" && <><label className={styles.search}><span>⌕</span><input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="Buscar productos, marcas o categorías…"/></label><label className={styles.headerSelect}><span>▣</span><select aria-label="Período global" value={filters.period} onChange={(event) => updateFilter("period", Number(event.target.value))}><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option></select></label><a className={styles.headerControl} href="/onboarding?change=1" title="Cambiar industria"><span>▱</span>{!filterOptions?.industrySlug || filterOptions.industrySlug === "all" ? "Todas las industrias" : filterOptions.industrySlug.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}</a></>}</header>
      {view !== "downloads" && view !== "usage" && <CommercialBanner account={commercialAccount}/>}
      {notice && <div className={styles.notice}>{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {view !== "downloads" && view !== "usage" && <section className={styles.filters}><div className={styles.typeFilter}><span>Tipo de retailer</span><div>{(["all", "supermarket", "department_store", "pharmacy", "home_improvement"] as RetailerType[]).map((type) => <button key={type} className={filters.retailerType === type ? styles.selected : ""} onClick={() => updateFilter("retailerType", type)}>{type === "all" ? "Todos" : type === "supermarket" ? "Supermercados" : type === "department_store" ? "Multitiendas" : type === "pharmacy" ? "Farmacias" : "Hogar y construcción"}</button>)}</div></div><label><span>Cadena</span><select value={filters.supermarket} onChange={(event) => updateFilter("supermarket", event.target.value)}><option value="">Todas</option>{chainFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({number(item.products)})</option>)}</select></label><label><span>Categoría</span><select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}><option value="">Todas</option>{categoryFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({number(item.products)})</option>)}</select></label><label><span>Marca</span><select value={filters.brand} onChange={(event) => updateFilter("brand", event.target.value)}><option value="">Todas</option>{brandFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.value} ({number(item.products)})</option>)}</select></label><label><span>Stock</span><select value={filters.stock} onChange={(event) => updateFilter("stock", event.target.value as Filters["stock"])}><option value="all">Todo</option><option value="in" disabled={cascadeOptions ? cascadeOptions.stock.in <= 0 : false}>Disponible{cascadeOptions ? ` (${number(cascadeOptions.stock.in)})` : ""}</option><option value="out" disabled={cascadeOptions ? cascadeOptions.stock.out <= 0 : false}>Sin stock{cascadeOptions ? ` (${number(cascadeOptions.stock.out)})` : ""}</option></select></label><label><span>Período</span><select value={filters.period} onChange={(event) => updateFilter("period", Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label><button className={styles.clear} onClick={clearFilters}>⌫ Limpiar</button></section>}
      {renderView()}
      </>}
    </main>
  </div>;
}

function Metric({ label, value, detail, tone = "blue" }: { label: string; value: string; detail: string; tone?: "blue" | "green" | "purple" | "orange" }) { return <article className={styles.metric}><i className={`${styles.metricDot} ${styles[tone]}`}/><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>; }
function CardHead({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className={styles.cardHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button onClick={onAction}>{action} →</button>}</header>; }
function Toolbar({ children }: { children: React.ReactNode }) { return <div className={styles.toolbar}>{children}</div>; }
function Loading({ label = "Cargando datos…" }: { label?: string }) { return <div className={styles.loading}><i/>{label}</div>; }
function Empty({ label }: { label: string }) { return <div className={styles.empty}>{label}</div>; }
function QuickAction({ title, copy, button, onClick }: { title: string; copy: string; button: string; onClick: () => void }) { return <article className={`${styles.card} ${styles.quickAction}`}><h3>{title}</h3><p>{copy}</p><button onClick={onClick}>{button} →</button></article>; }
function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: React.Dispatch<React.SetStateAction<number>> }) { return <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>← Anterior</button><span>Página {page} de {Math.max(1, totalPages)}</span><button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente →</button></div>; }
function NumberField({ label, value, step = "1", onChange }: { label: string; value: number; step?: string; onChange: (value: number) => void }) { return <label><span>{label}</span><input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>; }
