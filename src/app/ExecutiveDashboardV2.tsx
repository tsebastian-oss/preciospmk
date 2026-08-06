"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ExecutiveDashboardV2.module.css";

type Numeric = number | string;
type RetailerType = "all" | "supermarket" | "department_store" | "pharmacy";
type Summary = { total_products: Numeric; in_stock_products: Numeric; offers: Numeric; supermarkets: Numeric; average_price: Numeric; total_savings: Numeric; last_updated: string | null };
type RetailerSummary = { supermarket: string; products: Numeric; in_stock: Numeric; offers: Numeric; average_price: Numeric; average_discount: Numeric; last_updated: string | null };
type CrawlRun = { id: number; status: string; tasks_total: number; tasks_completed: number; tasks_failed: number; products_found: number };
type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; run: CrawlRun | null; error?: string };
type StorePulse = { supermarket: string; variationPct: number | null; matchedSkus: number; currentSkus: number; coveragePct: number | null; status: "ready" | "building"; latestObservationAt: string | null };
type PulsePayload = { data: StorePulse[]; latestObservationAt: string | null; previousDate: string | null; error?: string };
type MatchListing = { id: string; supermarket: string; name: string; brand: string | null; price: Numeric; regular_price: Numeric | null; in_stock: boolean; url: string; observed_at: string };
type ProductMatch = { match_key: string; canonical_name: string; canonical_brand: string | null; category: string | null; listings: number; supermarkets: number; best_price: Numeric; highest_price: Numeric; average_price: Numeric; price_gap: Numeric; savings_pct: Numeric; last_updated: string; best_supermarket: string; best_url: string; store_listings: MatchListing[] };
type MatchesPayload = { matches: ProductMatch[]; total: number; error?: string };
type TrendPoint = { date: string; price: number | null; skus: number | null };
type TrendSeries = { id: string; label: string; dimension: "category" | "brand"; kind: "group" | "smart" | "brand"; points: TrendPoint[] };
type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; error?: string };
type FilterOption = { id: string; label: string; kind: "group" | "smart" | "brand"; products: number; retailers: number };
type FilterPayload = { defaults: string[]; categories: FilterOption[]; brands: FilterOption[]; maxSeries: number; error?: string };
type IconName = "home" | "trend" | "match" | "download" | "category" | "retailer" | "alert" | "crawler" | "settings" | "search" | "calendar" | "layers" | "filter" | "box" | "store" | "pulse" | "target" | "shield" | "spark" | "arrow" | "refresh" | "database" | "chevron";

const numberFormatter = new Intl.NumberFormat("es-CL");
const compactFormatter = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const moneyFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const SERIES_COLORS = ["#246bfd", "#16a36a", "#8957e5", "#f59e0b", "#0ea5e9", "#ec4899", "#64748b", "#14b8a6"];
const SUPER_MARKETS = new Set(["lider", "jumbo", "santa isabel"]);
const DEPARTMENT_STORES = new Set(["paris", "falabella", "ripley"]);
const PHARMACIES = new Set(["cruz verde", "salcobrand", "farmacias ahumada", "ahumada"]);

function numeric(input: Numeric | null | undefined) { const parsed = Number(input ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function number(input: Numeric | null | undefined) { return numberFormatter.format(numeric(input)); }
function compact(input: Numeric | null | undefined) { return compactFormatter.format(numeric(input)); }
function money(input: Numeric | null | undefined) { return moneyFormatter.format(numeric(input)); }
function percent(input: number | null | undefined, digits = 1) { if (input === null || input === undefined || !Number.isFinite(input)) return "—"; const normalized = Math.abs(input) < 0.005 ? 0 : input; return `${normalized > 0 ? "+" : ""}${normalized.toFixed(digits)}%`; }
function retailerType(name: string): Exclude<RetailerType, "all"> { const normalized = name.trim().toLocaleLowerCase("es-CL"); if (SUPER_MARKETS.has(normalized)) return "supermarket"; if (DEPARTMENT_STORES.has(normalized)) return "department_store"; if (PHARMACIES.has(normalized)) return "pharmacy"; return "department_store"; }
function relativeTime(input: string | null | undefined) { if (!input) return "Sin actualización"; const difference = Math.max(0, Date.now() - new Date(input).getTime()); const minutes = Math.floor(difference / 60_000); if (minutes < 1) return "Ahora"; if (minutes < 60) return `Hace ${minutes} min`; const hours = Math.floor(minutes / 60); if (hours < 24) return `Hace ${hours} h`; return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(input)); }
function navigateTo(path: string) { window.location.assign(path); }

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>, trend: <><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>, match: <><rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/><path d="M10 9h4M10 15h4"/></>, download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>, category: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>, retailer: <><path d="M4 10h16"/><path d="m5 10 1-5h12l1 5"/><path d="M6 10v9h12v-9"/><path d="M9 19v-5h6v5"/></>, alert: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>, crawler: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>, layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>, filter: <><path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/></>, box: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h8M8 15h5"/></>, store: <><path d="M3 10h18"/><path d="m5 10 1-6h12l1 6"/><path d="M5 10v10h14V10"/></>, pulse: <path d="M3 12h4l2-6 4 12 2-6h6"/>, target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/></>, shield: <><path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-5"/></>, spark: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>, arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>, refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 1M3.9 15A7 7 0 0 0 16 18l2-1"/></>, database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>, chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function KpiCard({ icon, label, value, detail, tone = "blue" }: { icon: IconName; label: string; value: string; detail: string; tone?: "blue" | "green" | "purple" }) { return <article className={styles.kpiCard}><span className={`${styles.kpiIcon} ${styles[tone]}`}><Icon name={icon} size={21}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>; }
function Donut({ value, label, detail, color }: { value: string; label: string; detail: string; color: string }) { return <div className={styles.donutItem}><div className={styles.donut} style={{ "--donut-color": color } as React.CSSProperties}><span>{value}</span></div><strong>{label}</strong><small>{detail}</small></div>; }

export default function ExecutiveDashboardV2() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [pulse, setPulse] = useState<PulsePayload | null>(null);
  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], total: 0 });
  const [trend, setTrend] = useState<TrendPayload | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterPayload | null>(null);
  const [activeSeries, setActiveSeries] = useState<string[]>([]);
  const [retailerFilter, setRetailerFilter] = useState<RetailerType>("all");
  const [chainFilter, setChainFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  const loadCore = useCallback(async (quiet = false) => {
    if (quiet) setSyncing(true); else setLoading(true);
    try {
      const [dashboardResponse, pulseResponse, matchResponse, optionResponse] = await Promise.all([
        fetch(`/api/dashboard?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/weighted-price-pulse?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/matches?page=1&pageSize=8&sort=gap_desc&minSavings=0&quality=all&live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/daily-pricing-filter-options?live=${Date.now()}`, { cache: "no-store" }),
      ]);
      const [dashboardData, pulseData, matchData, optionData] = await Promise.all([
        dashboardResponse.json() as Promise<DashboardPayload>, pulseResponse.json() as Promise<PulsePayload>, matchResponse.json() as Promise<MatchesPayload>, optionResponse.json() as Promise<FilterPayload>,
      ]);
      if (!dashboardResponse.ok) throw new Error(dashboardData.error || "No fue posible cargar el resumen ejecutivo");
      setDashboard(dashboardData);
      if (pulseResponse.ok) setPulse(pulseData);
      if (matchResponse.ok) setMatches(matchData);
      if (optionResponse.ok) { setFilterOptions(optionData); setActiveSeries((current) => current.length ? current : (optionData.defaults ?? []).slice(0, 4)); }
      setNotice("");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "No fue posible cargar el dashboard"); }
    finally { setLoading(false); setSyncing(false); }
  }, []);

  useEffect(() => { void loadCore(); const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 30_000); return () => window.clearInterval(interval); }, [loadCore]);
  useEffect(() => {
    if (!activeSeries.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(period), live: String(Date.now()) });
    activeSeries.forEach((item) => params.append("series", item));
    fetch(`/api/daily-pricing-trend?${params.toString()}`, { cache: "no-store", signal: controller.signal }).then(async (response) => { const payload = await response.json() as TrendPayload; if (!response.ok) throw new Error(payload.error || "No fue posible cargar la evolución de precios"); setTrend(payload); }).catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setNotice(reason instanceof Error ? reason.message : "No fue posible cargar la evolución de precios"); });
    return () => controller.abort();
  }, [activeSeries, period]);

  const summary = dashboard?.summary;
  const allRetailers = dashboard?.supermarkets ?? [];
  const filteredRetailers = useMemo(() => allRetailers.filter((item) => { if (retailerFilter !== "all" && retailerType(item.supermarket) !== retailerFilter) return false; if (chainFilter && item.supermarket !== chainFilter) return false; return true; }), [allRetailers, retailerFilter, chainFilter]);
  const weightedVariation = useMemo(() => { const ready = (pulse?.data ?? []).filter((item) => item.status === "ready" && item.variationPct !== null); const totalWeight = ready.reduce((sum, item) => sum + Math.max(1, item.matchedSkus), 0); if (!totalWeight) return null; return ready.reduce((sum, item) => sum + (item.variationPct ?? 0) * Math.max(1, item.matchedSkus), 0) / totalWeight; }, [pulse]);
  const stockCoverage = summary ? numeric(summary.in_stock_products) / Math.max(1, numeric(summary.total_products)) * 100 : 0;
  const maxGap = Math.max(0, ...matches.matches.map((item) => numeric(item.price_gap)));
  const maxSavings = Math.max(0, ...matches.matches.map((item) => numeric(item.savings_pct)));
  const averageListings = matches.matches.length ? matches.matches.reduce((sum, item) => sum + item.listings, 0) / matches.matches.length : 0;
  const pulseMap = useMemo(() => new Map((pulse?.data ?? []).map((item) => [item.supermarket.toLocaleLowerCase("es-CL"), item])), [pulse]);
  const barRetailers = filteredRetailers.length ? filteredRetailers : allRetailers;
  const availableVariations = barRetailers.map((item) => pulseMap.get(item.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null).filter((item): item is number => item !== null);
  const chartAbs = Math.max(2, ...availableVariations.map((item) => Math.abs(item)));
  const filteredMatches = useMemo(() => { const term = productFilter.trim().toLocaleLowerCase("es-CL"); if (!term) return matches.matches.slice(0, 5); return matches.matches.filter((item) => `${item.canonical_name} ${item.canonical_brand ?? ""} ${item.category ?? ""}`.toLocaleLowerCase("es-CL").includes(term)).slice(0, 5); }, [matches.matches, productFilter]);
  const categoryOptions = filterOptions?.categories ?? [];
  const brandOptions = filterOptions?.brands ?? [];
  const optionMap = useMemo(() => new Map([...categoryOptions, ...brandOptions].map((item) => [item.id, item])), [categoryOptions, brandOptions]);
  const normalizedTrend = useMemo(() => (trend?.series ?? []).map((series, index) => { const valid = series.points.filter((point) => typeof point.price === "number" && Number.isFinite(point.price) && (point.price ?? 0) > 0); const base = valid[0]?.price ?? 1; return { ...series, color: SERIES_COLORS[index % SERIES_COLORS.length], points: series.points.map((point) => ({ ...point, index: point.price && base ? point.price / base * 100 : null })) }; }), [trend]);
  const trendDates = useMemo(() => [...new Set(normalizedTrend.flatMap((series) => series.points.map((point) => point.date)))].sort(), [normalizedTrend]);
  const chart = useMemo(() => { const width = 1040, height = 250, margin = { top: 18, right: 18, bottom: 36, left: 42 }; const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom; const values = normalizedTrend.flatMap((series) => series.points.map((point) => point.index)).filter((item): item is number => item !== null && Number.isFinite(item)); const min = values.length ? Math.min(...values, 94) : 94, max = values.length ? Math.max(...values, 106) : 106, padding = Math.max(2, (max - min) * .15), yMin = Math.floor(min - padding), yMax = Math.ceil(max + padding); const x = (index: number) => margin.left + (trendDates.length <= 1 ? plotWidth / 2 : index / (trendDates.length - 1) * plotWidth); const y = (value: number) => margin.top + (yMax - value) / Math.max(1, yMax - yMin) * plotHeight; const map = new Map(normalizedTrend.map((series) => [series.id, new Map(series.points.map((point) => [point.date, point.index]))])); const path = (seriesId: string) => trendDates.map((date, index) => { const value = map.get(seriesId)?.get(date); return value === null || value === undefined ? null : { x: x(index), y: y(value) }; }).filter((point): point is { x: number; y: number } => point !== null).map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "); return { width, height, margin, plotWidth, plotHeight, yMin, yMax, x, y, path }; }, [normalizedTrend, trendDates]);
  const insights = useMemo(() => { const ready = (pulse?.data ?? []).filter((item) => item.variationPct !== null); const highest = [...ready].sort((a, b) => (b.variationPct ?? 0) - (a.variationPct ?? 0))[0]; const lowest = [...ready].sort((a, b) => (a.variationPct ?? 0) - (b.variationPct ?? 0))[0]; const coverageLeader = [...allRetailers].sort((a, b) => numeric(b.products) - numeric(a.products))[0]; return [{ tone: "up", title: "Mayor alza ponderada", copy: highest ? `${highest.supermarket} ${percent(highest.variationPct)}` : "Esperando base comparable" }, { tone: "down", title: "Mayor baja ponderada", copy: lowest ? `${lowest.supermarket} ${percent(lowest.variationPct)}` : "Esperando base comparable" }, { tone: "opportunity", title: "Oportunidad destacada", copy: maxGap > 0 ? `Brecha visible de hasta ${money(maxGap)} en Price Matching` : coverageLeader ? `${coverageLeader.supermarket} lidera cobertura con ${number(coverageLeader.products)} SKU` : "Sin hallazgos pendientes" }]; }, [pulse, allRetailers, maxGap]);

  function resetFilters() { setRetailerFilter("all"); setChainFilter(""); setCategoryFilter(""); setBrandFilter(""); setProductFilter(""); }
  function addSeries(id: string) { if (!id) return; setActiveSeries((current) => current.includes(id) ? current : [...current, id].slice(0, filterOptions?.maxSeries ?? 8)); }

  return <div className={`app-shell ${styles.shell}`}>
    <aside className={`sidebar ${styles.sidebar}`}>
      <button className={styles.brand} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className={styles.logoMark}><i/><i/><i/></span><span><strong>MGP Intelligence</strong><small>Inteligencia de Precios</small></span></button>
      <nav className={styles.nav}>
        <button className={styles.active} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Icon name="home"/><span>Resumen</span></button>
        <button onClick={() => document.getElementById("price-variation")?.scrollIntoView({ behavior: "smooth" })}><Icon name="trend"/><span>Variación de Precios</span></button>
        <button onClick={() => navigateTo("/workspace#price-matching")}><Icon name="match"/><span>Price Matching</span></button>
        <button onClick={() => { window.location.hash = "data-exports"; }}><Icon name="download"/><span>Descarga de Bases</span></button>
        <button onClick={() => navigateTo("/workspace#products")}><Icon name="category"/><span>Categorías</span></button>
        <button onClick={() => navigateTo("/workspace#assortment-gaps")}><Icon name="retailer"/><span>Retailers</span></button>
        <button onClick={() => navigateTo("/workspace#price-movements")}><Icon name="alert"/><span>Alertas</span><b>{dashboard?.run?.tasks_failed ?? 0}</b></button>
        <button onClick={() => document.getElementById("scraping-status")?.scrollIntoView({ behavior: "smooth" })}><Icon name="crawler"/><span>Scraping Status</span></button>
        <button onClick={() => navigateTo("/workspace#retailer-overview")}><Icon name="settings"/><span>Configuración</span></button>
      </nav>
      <div className={styles.sidebarAccount}><div><span>MG</span><div><strong>MGP Team</strong><small>Admin</small></div><Icon name="chevron" size={15}/></div><hr/><small>Plan Enterprise</small><strong>{number(summary?.total_products)} SKU monitoreados</strong><div className={styles.sidebarProgress}><span style={{ width: `${Math.min(100, stockCoverage)}%` }}/></div><p><i/> Pipeline {dashboard?.run?.status === "running" ? "procesando" : "operativo"}</p></div>
    </aside>

    <main className={styles.main}>
      <header className={styles.topbar}><div><h1>Resumen Ejecutivo</h1><p>Panorama general del monitoreo de precios en Chile</p></div><label className={styles.globalSearch}><Icon name="search" size={17}/><input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Buscar productos, categorías o retailers..."/></label><button className={styles.topControl}><Icon name="calendar" size={17}/><span>Últimos {period} días</span></button><button className={styles.topControl}><Icon name="layers" size={17}/><span>Todas las industrias</span><Icon name="chevron" size={14}/></button></header>
      {notice && <div className={styles.notice}>{notice}<button onClick={() => setNotice("")}>×</button></div>}
      <section className={styles.filterPanel}>
        <div className={styles.retailerTabs}><span>Tipo de retailer</span><div><button className={retailerFilter === "all" ? styles.selected : ""} onClick={() => setRetailerFilter("all")}>Todos</button><button className={retailerFilter === "supermarket" ? styles.selected : ""} onClick={() => setRetailerFilter("supermarket")}>Supermercados</button><button className={retailerFilter === "department_store" ? styles.selected : ""} onClick={() => setRetailerFilter("department_store")}>Multitiendas</button><button className={retailerFilter === "pharmacy" ? styles.selected : ""} onClick={() => setRetailerFilter("pharmacy")}>Farmacias</button></div></div>
        <label><span>Cadena</span><select value={chainFilter} onChange={(event) => setChainFilter(event.target.value)}><option value="">Todas</option>{allRetailers.map((item) => <option key={item.supermarket}>{item.supermarket}</option>)}</select></label>
        <label><span>Categoría</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas</option>{categoryOptions.slice(0, 60).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Marca</span><select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="">Todas</option>{brandOptions.slice(0, 60).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Período</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label>
        <button className={styles.clearFilters} onClick={resetFilters}><Icon name="filter" size={16}/> Limpiar filtros</button>
      </section>

      <section className={styles.kpis}><KpiCard icon="box" label="SKUs monitoreados" value={loading ? "—" : number(summary?.total_products)} detail={`${number(filteredRetailers.reduce((sum, item) => sum + numeric(item.products), 0))} visibles con filtros`} tone="purple"/><KpiCard icon="store" label="Retailers activos" value={loading ? "—" : number(filteredRetailers.length || allRetailers.length)} detail="Fuentes con catálogo capturado" tone="blue"/><KpiCard icon="pulse" label="Observaciones del día" value={loading ? "—" : number(trend?.currentDayObservations ?? 0)} detail={`Actualizado ${relativeTime(trend?.latestObservationAt)}`} tone="blue"/><KpiCard icon="trend" label="Variación ponderada" value={loading ? "—" : percent(weightedVariation)} detail="Mismos SKU vs. día anterior" tone="green"/><KpiCard icon="target" label="Matches detectados" value={loading ? "—" : number(matches.total)} detail="Comparables entre 3 supermercados" tone="purple"/><KpiCard icon="shield" label="Cobertura de stock" value={loading ? "—" : `${stockCoverage.toFixed(1)}%`} detail={`${number(summary?.in_stock_products)} SKU disponibles`} tone="green"/></section>

      <section className={styles.dashboardGrid}>
        <article id="price-variation" className={`${styles.card} ${styles.variationCard}`}><header className={styles.cardHeader}><div><h2>Variación ponderada vs. día anterior por cadena</h2><p>Comparación sobre los mismos SKU observados en ambos días.</p></div><button onClick={() => navigateTo("/workspace#price-movements")}>Ver detalle <Icon name="arrow" size={15}/></button></header><div className={styles.chartToggle}><button className={styles.selected}>% Variación</button><button>Índice base 100</button></div><div className={styles.barChart}><div className={styles.yAxis}><span>+{chartAbs.toFixed(0)}%</span><span>0%</span><span>-{chartAbs.toFixed(0)}%</span></div><div className={styles.zeroLine}/><div className={styles.bars}>{barRetailers.map((retailer) => { const variation = pulseMap.get(retailer.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null; const height = variation === null ? 2 : Math.max(4, Math.abs(variation) / chartAbs * 44); return <div key={retailer.supermarket} className={styles.barColumn}><span className={styles.barValue}>{variation === null ? "—" : percent(variation)}</span><div className={styles.barTrack}><i className={variation === null ? styles.missingBar : variation >= 0 ? styles.positiveBar : styles.negativeBar} style={{ height: `${height}%`, top: variation !== null && variation < 0 ? "50%" : `${50 - height}%` }}/></div><small>{retailer.supermarket.replace("Farmacias ", "")}</small></div>; })}</div></div><footer className={styles.methodNote}><Icon name="pulse" size={15}/><span>Las cadenas sin base comparable se muestran sin variación. El cálculo pondera por SKU coincidentes.</span></footer></article>

        <article className={`${styles.card} ${styles.matchCard}`}><header className={styles.cardHeader}><div><h2>Price Matching</h2><p>Comparación validada entre Lider, Jumbo y Santa Isabel.</p></div><button onClick={() => navigateTo("/workspace#price-matching")}>Análisis completo <Icon name="arrow" size={15}/></button></header><div className={styles.donutGrid}><Donut value={compact(matches.total)} label="Matches 3 cadenas" detail="Cobertura completa" color="#246bfd"/><Donut value={`${maxSavings.toFixed(0)}%`} label="Mayor ahorro" detail={money(maxGap)} color="#16a36a"/><Donut value={averageListings.toFixed(1)} label="Fichas por match" detail="Promedio visible" color="#8957e5"/></div><div className={styles.matchTable}><div className={styles.tableHead}><span>Producto</span><span>Cadenas</span><span>Mejor precio</span><span>Brecha</span></div>{filteredMatches.map((match) => <button key={match.match_key} onClick={() => navigateTo("/workspace#price-matching")}><span><strong>{match.canonical_name}</strong><small>{match.canonical_brand || match.category || "Sin marca"}</small></span><span>{match.supermarkets}</span><span>{money(match.best_price)}</span><b>{money(match.price_gap)}</b></button>)}{!filteredMatches.length && <div className={styles.empty}>Sin matches para esa búsqueda.</div>}</div></article>

        <aside className={styles.rightColumn}>
          <article className={`${styles.card} ${styles.downloadCard}`}><header><span><Icon name="download" size={18}/></span><div><h2>Descarga de bases</h2><p>Exporta el histórico autorizado.</p></div></header><label><span>Período</span><div><Icon name="calendar" size={15}/><b>Últimos {period} días</b></div></label><label><span>Categoría</span><div><b>{categoryFilter ? optionMap.get(categoryFilter)?.label ?? "Seleccionada" : "Todas las categorías"}</b><Icon name="chevron" size={14}/></div></label><label><span>Producto</span><div><b>{productFilter || "Todos los productos"}</b><Icon name="chevron" size={14}/></div></label><div className={styles.formatButtons}><button className={styles.excel}>Excel (.xlsx)</button><button>CSV (.csv)</button></div><button className={styles.downloadButton} onClick={() => { window.location.hash = "data-exports"; }}>Descargar base</button></article>
          <article className={`${styles.card} ${styles.insightsCard}`}><header><span><Icon name="spark" size={20}/></span><div><h2>IA / Insights</h2><p>Hallazgos priorizados del mercado.</p></div></header><div className={styles.insightTabs}><button className={styles.selected}>Resumen</button><button>Oportunidades</button><button>Alertas</button></div><div className={styles.insightList}>{insights.map((item) => <button key={item.title}><i className={styles[item.tone]}/><span><strong>{item.title}</strong><small>{item.copy}</small></span><Icon name="chevron" size={15}/></button>)}</div><button className={styles.linkButton} onClick={() => navigateTo("/workspace#competitive")}>Ver todos los insights <Icon name="arrow" size={14}/></button></article>
          <article id="scraping-status" className={`${styles.card} ${styles.scrapingCard}`}><header><div><h2>Estado del scraping</h2><p><i/> {dashboard?.run?.status === "running" ? "Procesando catálogo" : "Todo operativo"}</p></div><button onClick={() => void loadCore(true)}><Icon name="refresh" size={16}/></button></header><div className={styles.scrapingTable}><div><span>Retailer</span><span>Estado</span><span>Actualización</span></div>{allRetailers.slice(0, 7).map((retailer) => <div key={retailer.supermarket}><strong>{retailer.supermarket}</strong><b>Operativo</b><small>{relativeTime(retailer.last_updated)}</small></div>)}</div><footer><span>{syncing ? "Sincronizando…" : `${number(dashboard?.run?.tasks_completed)} tareas completadas`}</span><button onClick={() => navigateTo("/workspace#retailer-overview")}>Ver operación <Icon name="arrow" size={13}/></button></footer></article>
        </aside>
      </section>

      <section id="trend" className={`${styles.card} ${styles.trendCard}`}><header className={styles.cardHeader}><div><h2>Evolución de precios promedio</h2><p>Índice base 100 para comparar categorías y marcas con distinta escala.</p></div><div className={styles.periodTabs}><button className={period === 7 ? styles.selected : ""} onClick={() => setPeriod(7)}>7D</button><button className={period === 30 ? styles.selected : ""} onClick={() => setPeriod(30)}>30D</button><button className={period === 90 ? styles.selected : ""} onClick={() => setPeriod(90)}>90D</button></div></header><div className={styles.seriesToolbar}><div><span>Categorías</span>{activeSeries.filter((id) => optionMap.get(id)?.kind !== "brand").map((id) => <button key={id} onClick={() => setActiveSeries((current) => current.filter((item) => item !== id))}>{optionMap.get(id)?.label ?? id} ×</button>)}<select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Agregar categoría</option>{categoryOptions.filter((item) => !activeSeries.includes(item.id)).slice(0, 100).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div><span>Marcas</span>{activeSeries.filter((id) => optionMap.get(id)?.kind === "brand").map((id) => <button key={id} onClick={() => setActiveSeries((current) => current.filter((item) => item !== id))}>{optionMap.get(id)?.label ?? id} ×</button>)}<select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Agregar marca</option>{brandOptions.filter((item) => !activeSeries.includes(item.id)).slice(0, 100).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></div><div className={styles.lineChartWrap}>{normalizedTrend.length ? <svg className={styles.lineChart} viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Evolución de precios promedio">{[0, 1, 2, 3, 4].map((index) => { const value = chart.yMax - index * (chart.yMax - chart.yMin) / 4; const y = chart.y(value); return <g key={index}><line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={y} y2={y}/><text x={chart.margin.left - 8} y={y + 4}>{value.toFixed(0)}</text></g>; })}{normalizedTrend.map((series) => <path key={series.id} d={chart.path(series.id)} stroke={series.color}/>)}{trendDates.filter((_, index) => index === 0 || index === trendDates.length - 1 || index % Math.max(1, Math.ceil(trendDates.length / 5)) === 0).map((date) => { const index = trendDates.indexOf(date); return <text key={date} className={styles.xLabel} x={chart.x(index)} y={chart.height - 8}>{new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "")}</text>; })}</svg> : <div className={styles.chartLoading}>{loading ? "Cargando evolución…" : "Selecciona categorías o marcas para construir el gráfico."}</div>}</div><footer className={styles.legend}>{normalizedTrend.map((series) => <span key={series.id}><i style={{ background: series.color }}/>{series.label}</span>)}</footer></section>
      <footer className={styles.pageFooter}><span><Icon name="database" size={15}/> Datos públicos normalizados · actualización automática</span><small>Última captura {relativeTime(summary?.last_updated)}</small></footer>
    </main>
  </div>;
}
