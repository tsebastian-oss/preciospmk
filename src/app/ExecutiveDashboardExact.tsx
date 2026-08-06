"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./ExecutiveDashboardExact.module.css";

type Numeric = number | string;
type Scope = "all" | "supermarket" | "department_store" | "pharmacy";
type Summary = { total_products: Numeric; in_stock_products: Numeric; offers: Numeric; supermarkets: Numeric; average_price: Numeric; total_savings: Numeric; last_updated: string | null };
type Retailer = { supermarket: string; products: Numeric; in_stock: Numeric; offers: Numeric; average_price: Numeric; average_discount: Numeric; last_updated: string | null };
type Run = { status: string; tasks_total: number; tasks_completed: number; tasks_failed: number; products_found: number };
type DashboardPayload = { summary: Summary | null; supermarkets: Retailer[]; run: Run | null; error?: string };
type PulseItem = { supermarket: string; variationPct: number | null; matchedSkus: number; currentSkus: number; coveragePct: number | null; status: "ready" | "building"; latestObservationAt: string | null };
type PulsePayload = { data: PulseItem[]; latestObservationAt: string | null; previousDate: string | null; error?: string };
type Match = { match_key: string; canonical_name: string; canonical_brand: string | null; category: string | null; listings: number; supermarkets: number; best_price: Numeric; highest_price: Numeric; average_price: Numeric; price_gap: Numeric; savings_pct: Numeric; last_updated: string; best_supermarket: string; store_listings: Array<{ supermarket: string; price: Numeric }> };
type MatchesPayload = { matches: Match[]; total: number; error?: string };
type FilterOption = { id: string; label: string; kind: "group" | "smart" | "brand"; products: number; retailers: number };
type FiltersPayload = { defaults: string[]; categories: FilterOption[]; brands: FilterOption[]; maxSeries: number; error?: string };
type TrendPoint = { date: string; price: number | null; skus: number | null };
type TrendSeries = { id: string; label: string; dimension: "category" | "brand"; kind: "group" | "smart" | "brand"; points: TrendPoint[] };
type TrendPayload = { series: TrendSeries[]; currentDayObservations: number; latestObservationAt: string | null; error?: string };
type IconName = "home" | "trend" | "match" | "download" | "grid" | "store" | "bell" | "crawler" | "settings" | "search" | "calendar" | "layers" | "filter" | "box" | "pulse" | "target" | "shield" | "spark" | "arrow" | "refresh" | "chevron" | "database" | "check";

const integer = new Intl.NumberFormat("es-CL");
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const COLORS = ["#246BFD", "#15A56B", "#8A55E6", "#F2A100", "#0EA5E9", "#EC4899", "#64748B", "#14B8A6"];
const SUPERMARKETS = new Set(["lider", "jumbo", "santa isabel"]);
const DEPARTMENT_STORES = new Set(["paris", "falabella", "ripley"]);
const PHARMACIES = new Set(["cruz verde", "salcobrand", "farmacias ahumada", "ahumada"]);

function n(value: Numeric | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: Numeric | null | undefined) { return integer.format(n(value)); }
function money(value: Numeric | null | undefined) { return currency.format(n(value)); }
function pct(value: number | null | undefined, digits = 1) { if (value === null || value === undefined || !Number.isFinite(value)) return "—"; const clean = Math.abs(value) < .005 ? 0 : value; return `${clean > 0 ? "+" : ""}${clean.toLocaleString("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`; }
function kind(name: string): Exclude<Scope, "all"> { const normalized = name.trim().toLocaleLowerCase("es-CL"); if (SUPERMARKETS.has(normalized)) return "supermarket"; if (PHARMACIES.has(normalized)) return "pharmacy"; if (DEPARTMENT_STORES.has(normalized)) return "department_store"; return "department_store"; }
function relative(value: string | null | undefined) { if (!value) return "Sin actualización"; const delta = Math.max(0, Date.now() - new Date(value).getTime()); const minutes = Math.floor(delta / 60000); if (minutes < 1) return "Ahora"; if (minutes < 60) return `Hace ${minutes} min`; const hours = Math.floor(minutes / 60); if (hours < 24) return `Hace ${hours} h`; return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(value)).replace(".", ""); }
function dateRange(period: number, endValue: string | null | undefined) { const end = endValue ? new Date(endValue) : new Date(); const start = new Date(end); start.setDate(start.getDate() - Math.max(0, period - 1)); const formatter = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }); return `${formatter.format(start).replace(".", "")} - ${formatter.format(end).replace(".", "")}`; }
function go(path: string) { window.location.assign(path); }

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const nodes: Record<IconName, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,
    trend: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
    match: <><rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/><path d="M10 9h4M10 15h4"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    store: <><path d="M4 10h16m-15 0 1-5h12l1 5M6 10v9h12v-9M9 19v-5h6v5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    crawler: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.9 4.9 7 7m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17M17 7l2.1-2.1"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1v4a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5m-18 5 9 5 9-5"/></>,
    filter: <><path d="M4 5h16M7 12h10M10 19h4"/></>,
    box: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
    pulse: <path d="M3 12h4l2-6 4 12 2-6h6"/>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/></>,
    shield: <><path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-5"/></>,
    spark: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 1M3.9 15A7 7 0 0 0 16 18l2-1"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg {...props}>{nodes[name]}</svg>;
}

function Kpi({ icon, label, value, detail, tone }: { icon: IconName; label: string; value: string; detail: string; tone: "blue" | "green" | "purple" }) {
  return <article className={styles.kpi}><span className={`${styles.kpiIcon} ${styles[tone]}`}><Icon name={icon} size={21}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function Ring({ value, label, note, color, fill = 68 }: { value: string; label: string; note: string; color: string; fill?: number }) {
  return <div className={styles.ringMetric}><div className={styles.ring} style={{ "--ring": color, "--fill": `${fill}%` } as CSSProperties}><span>{value}</span></div><strong>{label}</strong><small>{note}</small></div>;
}

export default function ExecutiveDashboardExact() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [pulse, setPulse] = useState<PulsePayload | null>(null);
  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], total: 0 });
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [trend, setTrend] = useState<TrendPayload | null>(null);
  const [activeSeries, setActiveSeries] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [chain, setChain] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [period, setPeriod] = useState(90);
  const [scrapingStatus, setScrapingStatus] = useState("all");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setSyncing(true); else setLoading(true);
    try {
      const responses = await Promise.all([
        fetch(`/api/dashboard?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/weighted-price-pulse?live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/matches?page=1&pageSize=12&sort=gap_desc&minSavings=0&quality=all&live=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/daily-pricing-filter-options?live=${Date.now()}`, { cache: "no-store" }),
      ]);
      const [dashboardData, pulseData, matchData, filterData] = await Promise.all([
        responses[0].json() as Promise<DashboardPayload>, responses[1].json() as Promise<PulsePayload>, responses[2].json() as Promise<MatchesPayload>, responses[3].json() as Promise<FiltersPayload>,
      ]);
      if (!responses[0].ok) throw new Error(dashboardData.error || "No fue posible cargar el dashboard");
      setDashboard(dashboardData);
      if (responses[1].ok) setPulse(pulseData);
      if (responses[2].ok) setMatches(matchData);
      if (responses[3].ok) {
        setFilters(filterData);
        setActiveSeries((current) => current.length ? current : (filterData.defaults ?? []).slice(0, 4));
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar el dashboard");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!activeSeries.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(period), live: String(Date.now()) });
    activeSeries.forEach((series) => params.append("series", series));
    fetch(`/api/daily-pricing-trend?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as TrendPayload; if (!response.ok) throw new Error(payload.error || "No fue posible cargar la tendencia"); setTrend(payload); })
      .catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError(reason instanceof Error ? reason.message : "No fue posible cargar la tendencia"); });
    return () => controller.abort();
  }, [activeSeries, period]);

  const summary = dashboard?.summary;
  const retailers = dashboard?.supermarkets ?? [];
  const categoryOptions = filters?.categories ?? [];
  const groupCategories = categoryOptions.filter((item) => item.kind === "group");
  const smartCategories = categoryOptions.filter((item) => item.kind === "smart");
  const brandOptions = filters?.brands ?? [];
  const optionMap = useMemo(() => new Map([...categoryOptions, ...brandOptions].map((item) => [item.id, item])), [categoryOptions, brandOptions]);
  const visibleRetailers = useMemo(() => retailers.filter((item) => (scope === "all" || kind(item.supermarket) === scope) && (!chain || item.supermarket === chain)), [retailers, scope, chain]);
  const filteredSku = visibleRetailers.reduce((sum, item) => sum + n(item.products), 0);
  const stockCoverage = summary ? n(summary.in_stock_products) / Math.max(1, n(summary.total_products)) * 100 : 0;
  const pulseMap = useMemo(() => new Map((pulse?.data ?? []).map((item) => [item.supermarket.toLocaleLowerCase("es-CL"), item])), [pulse]);
  const weightedVariation = useMemo(() => {
    const ready = (pulse?.data ?? []).filter((item) => item.status === "ready" && item.variationPct !== null);
    const denominator = ready.reduce((sum, item) => sum + Math.max(1, item.matchedSkus), 0);
    return denominator ? ready.reduce((sum, item) => sum + (item.variationPct ?? 0) * Math.max(1, item.matchedSkus), 0) / denominator : null;
  }, [pulse]);
  const chartRetailers = visibleRetailers.length ? visibleRetailers : retailers;
  const variations = chartRetailers.map((item) => pulseMap.get(item.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null).filter((item): item is number => item !== null);
  const maxVariation = Math.max(2, ...variations.map((item) => Math.abs(item)));
  const selectedMatches = useMemo(() => {
    const term = product.trim().toLocaleLowerCase("es-CL");
    return matches.matches.filter((item) => !term || `${item.canonical_name} ${item.canonical_brand ?? ""} ${item.category ?? ""}`.toLocaleLowerCase("es-CL").includes(term)).slice(0, 5);
  }, [matches.matches, product]);
  const biggestGap = Math.max(0, ...matches.matches.map((item) => n(item.price_gap)));
  const biggestSaving = Math.max(0, ...matches.matches.map((item) => n(item.savings_pct)));
  const averageListings = matches.matches.length ? matches.matches.reduce((sum, item) => sum + item.listings, 0) / matches.matches.length : 0;
  const normalizedSeries = useMemo(() => (trend?.series ?? []).map((series, index) => {
    const first = series.points.find((point) => typeof point.price === "number" && Number.isFinite(point.price) && (point.price ?? 0) > 0)?.price ?? 1;
    return { ...series, color: COLORS[index % COLORS.length], points: series.points.map((point) => ({ ...point, indexed: point.price && first ? point.price / first * 100 : null })) };
  }), [trend]);
  const dates = useMemo(() => [...new Set(normalizedSeries.flatMap((series) => series.points.map((point) => point.date)))].sort(), [normalizedSeries]);
  const lineModel = useMemo(() => {
    const width = 1080, height = 270, margin = { top: 18, right: 18, bottom: 38, left: 48 };
    const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
    const values = normalizedSeries.flatMap((series) => series.points.map((point) => point.indexed)).filter((item): item is number => item !== null && Number.isFinite(item));
    const rawMin = values.length ? Math.min(...values, 94) : 94, rawMax = values.length ? Math.max(...values, 106) : 106;
    const padding = Math.max(2, (rawMax - rawMin) * .15), min = Math.floor(rawMin - padding), max = Math.ceil(rawMax + padding);
    const x = (index: number) => margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
    const y = (value: number) => margin.top + (max - value) / Math.max(1, max - min) * plotHeight;
    const maps = new Map(normalizedSeries.map((series) => [series.id, new Map(series.points.map((point) => [point.date, point.indexed]))]));
    const path = (id: string) => dates.map((date, index) => { const value = maps.get(id)?.get(date); return value === null || value === undefined ? null : { x: x(index), y: y(value) }; }).filter((point): point is { x: number; y: number } => point !== null).map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    return { width, height, margin, plotWidth, plotHeight, min, max, x, y, path };
  }, [normalizedSeries, dates]);
  const insights = useMemo(() => {
    const ready = (pulse?.data ?? []).filter((item) => item.variationPct !== null);
    const up = [...ready].sort((a, b) => (b.variationPct ?? 0) - (a.variationPct ?? 0))[0];
    const down = [...ready].sort((a, b) => (a.variationPct ?? 0) - (b.variationPct ?? 0))[0];
    return [
      { tone: "up", title: "Categoría o cadena con alza relevante", detail: up ? `${up.supermarket} ${pct(up.variationPct)}` : "Construyendo base comparable" },
      { tone: "down", title: "Categoría o cadena con baja relevante", detail: down ? `${down.supermarket} ${pct(down.variationPct)}` : "Construyendo base comparable" },
      { tone: "opportunity", title: "Oportunidad destacada", detail: biggestGap ? `Brechas de hasta ${money(biggestGap)} en Price Matching` : "Sin brechas relevantes pendientes" },
    ];
  }, [pulse, biggestGap]);

  function clearFilters() { setScope("all"); setChain(""); setCategory(""); setSubcategory(""); setBrand(""); setProduct(""); setScrapingStatus("all"); }
  function addSeries(id: string) { if (!id) return; setActiveSeries((current) => current.includes(id) ? current : [...current, id].slice(0, filters?.maxSeries ?? 8)); }
  const navigation = [
    { label: "Resumen", icon: "home" as const, action: () => window.scrollTo({ top: 0, behavior: "smooth" }), active: true },
    { label: "Variación de Precios", icon: "trend" as const, action: () => document.getElementById("variation")?.scrollIntoView({ behavior: "smooth" }) },
    { label: "Price Matching", icon: "match" as const, action: () => go("/workspace#price-matching") },
    { label: "Descarga de Bases", icon: "download" as const, action: () => go("/workspace#data-exports") },
    { label: "Categorías", icon: "grid" as const, action: () => go("/workspace#products") },
    { label: "Retailers", icon: "store" as const, action: () => go("/workspace#assortment-gaps") },
    { label: "Alertas", icon: "bell" as const, action: () => go("/workspace#price-movements"), badge: dashboard?.run?.tasks_failed ?? 0 },
    { label: "Scraping Status", icon: "crawler" as const, action: () => document.getElementById("scraping")?.scrollIntoView({ behavior: "smooth" }) },
    { label: "Configuración", icon: "settings" as const, action: () => go("/workspace#retailer-overview") },
  ];

  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <button className={styles.brand} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className={styles.logo}><i/><i/><i/></span><span><strong>MGP Intelligence</strong><small>Inteligencia de Precios</small></span></button>
      <nav>{navigation.map((item) => <button key={item.label} className={item.active ? styles.active : ""} onClick={item.action}><Icon name={item.icon}/><span>{item.label}</span>{Boolean(item.badge) && <b>{item.badge}</b>}</button>)}</nav>
      <section className={styles.account}><div><span>MG</span><div><strong>MGP Team</strong><small>Admin</small></div><Icon name="chevron" size={15}/></div><hr/><small>Plan Enterprise</small><p>Renovación: 12 Sep 2026</p><div className={styles.usage}><span style={{ width: `${Math.min(100, stockCoverage)}%` }}/></div><small>Uso de consultas</small><strong>{fmt(summary?.total_products)} / 320.000</strong></section>
    </aside>

    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.title}><h1>Resumen Ejecutivo</h1><p>Panorama general del monitoreo de precios en Chile</p></div>
        <label className={styles.search}><Icon name="search" size={16}/><input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Buscar productos, categorías o retailers..."/></label>
        <button className={styles.headerControl}><Icon name="calendar" size={16}/><span>{dateRange(period, summary?.last_updated)}</span><Icon name="calendar" size={15}/></button>
        <button className={styles.headerControl}><Icon name="layers" size={16}/><span>Todas las industrias</span><Icon name="chevron" size={14}/></button>
      </header>

      {error && <div className={styles.error}>{error}<button onClick={() => setError("")}>×</button></div>}

      <section className={styles.filters}>
        <div className={styles.scope}><span>Tipo de retailer</span><div><button className={scope === "supermarket" ? styles.selected : ""} onClick={() => setScope(scope === "supermarket" ? "all" : "supermarket")}>Supermercados</button><button className={scope === "department_store" ? styles.selected : ""} onClick={() => setScope(scope === "department_store" ? "all" : "department_store")}>Multitiendas</button><button className={scope === "pharmacy" ? styles.selected : ""} onClick={() => setScope(scope === "pharmacy" ? "all" : "pharmacy")}>Farmacias</button></div></div>
        <label><span>Cadena</span><select value={chain} onChange={(event) => setChain(event.target.value)}><option value="">Todas</option>{retailers.map((item) => <option key={item.supermarket}>{item.supermarket}</option>)}</select></label>
        <label><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas</option>{groupCategories.slice(0, 80).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Subcategoría</span><select value={subcategory} onChange={(event) => setSubcategory(event.target.value)}><option value="">Todas</option>{smartCategories.slice(0, 100).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Marca</span><select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas</option>{brandOptions.slice(0, 100).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Producto</span><input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Buscar producto..."/></label>
        <label><span>Período</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option></select></label>
        <label><span>Estado scraping</span><select value={scrapingStatus} onChange={(event) => setScrapingStatus(event.target.value)}><option value="all">Todos</option><option value="operational">Operativo</option><option value="running">En curso</option><option value="error">Con errores</option></select></label>
        <button className={styles.clear} onClick={clearFilters}><Icon name="filter" size={15}/> Limpiar filtros</button>
      </section>

      <section className={styles.kpis}>
        <Kpi icon="box" label="SKUs monitoreados" value={loading ? "—" : fmt(summary?.total_products)} detail={`${fmt(filteredSku || summary?.total_products)} visibles con filtros`} tone="purple"/>
        <Kpi icon="store" label="Retailers activos" value={loading ? "—" : fmt(visibleRetailers.length || retailers.length)} detail="100% del total configurado" tone="blue"/>
        <Kpi icon="pulse" label="Observaciones del día" value={loading ? "—" : fmt(trend?.currentDayObservations ?? 0)} detail={`Actualizado ${relative(trend?.latestObservationAt)}`} tone="blue"/>
        <Kpi icon="trend" label="Variación ponderada promedio" value={loading ? "—" : pct(weightedVariation, 2)} detail="vs. día anterior" tone="green"/>
        <Kpi icon="target" label="Matches detectados" value={loading ? "—" : fmt(matches.total)} detail="Comparables entre supermercados" tone="purple"/>
        <Kpi icon="shield" label="Cobertura de precios" value={loading ? "—" : `${stockCoverage.toFixed(1)}%`} detail={`${fmt(summary?.in_stock_products)} SKU disponibles`} tone="green"/>
      </section>

      <section className={styles.contentGrid}>
        <article id="variation" className={`${styles.card} ${styles.variationCard}`}>
          <header className={styles.cardHeader}><div><h2>Variación ponderada vs día anterior por cadena</h2></div><button onClick={() => go("/workspace#price-movements")}>Ver detalle <Icon name="arrow" size={14}/></button></header>
          <div className={styles.segmented}><button className={styles.selected}>% Variación</button><button>Índice (Base 100)</button></div>
          <div className={styles.barChart}><div className={styles.axis}><span>{maxVariation.toFixed(1)}%</span><span>0%</span><span>-{maxVariation.toFixed(1)}%</span></div><div className={styles.gridLines}><i/><i/><i/></div><div className={styles.bars}>{chartRetailers.map((retailer) => { const variation = pulseMap.get(retailer.supermarket.toLocaleLowerCase("es-CL"))?.variationPct ?? null; const height = variation === null ? 2 : Math.max(4, Math.abs(variation) / maxVariation * 43); return <div className={styles.barItem} key={retailer.supermarket}><b>{variation === null ? "—" : pct(variation, 2)}</b><div><i className={variation === null ? styles.emptyBar : variation >= 0 ? styles.upBar : styles.downBar} style={{ height: `${height}%`, top: variation !== null && variation < 0 ? "50%" : `${50 - height}%` }}/></div><span>{retailer.supermarket.replace("Farmacias ", "")}</span></div>; })}</div></div>
          <footer><Icon name="pulse" size={14}/><span>Variación ponderada calculada sobre los mismos SKU observados en ambas fechas.</span></footer>
        </article>

        <article className={`${styles.card} ${styles.matchCard}`}>
          <header className={styles.cardHeader}><div><h2>Price Matching</h2><p>Coincidencias validadas entre supermercados</p></div><button onClick={() => go("/workspace#price-matching")}>Ver análisis completo <Icon name="arrow" size={14}/></button></header>
          <div className={styles.rings}><Ring value={compact.format(matches.total)} label="Matches 3 cadenas" note="Cobertura completa" color="#246BFD" fill={72}/><Ring value={`${biggestSaving.toFixed(0)}%`} label="Mayor ahorro" note={money(biggestGap)} color="#16A36A" fill={60}/><Ring value={averageListings.toFixed(1)} label="Fichas por match" note="Promedio visible" color="#8A55E6" fill={55}/></div>
          <div className={styles.matchTable}><h3>Coincidencias destacadas hoy</h3><div className={styles.matchHead}><span>Producto</span><span>Cadenas</span><span>Precio</span><span>Diferencia</span></div>{selectedMatches.map((match) => <button key={match.match_key} onClick={() => go("/workspace#price-matching")}><span><strong>{match.canonical_name}</strong><small>{match.canonical_brand || match.category || "Sin marca"}</small></span><span>{match.supermarkets}</span><span>{money(match.best_price)}</span><b>{money(match.price_gap)}</b></button>)}{!selectedMatches.length && <p className={styles.empty}>Sin coincidencias para esa búsqueda.</p>}</div>
        </article>

        <aside className={styles.rightRail}>
          <article className={`${styles.card} ${styles.exportCard}`}><header><span><Icon name="download" size={18}/></span><h2>Descarga de bases</h2></header><label><span>Período</span><div><b>{dateRange(period, summary?.last_updated)}</b><Icon name="calendar" size={14}/></div></label><label><span>Categoría</span><div><b>{category ? optionMap.get(category)?.label ?? "Seleccionada" : "Todas las categorías"}</b><Icon name="chevron" size={13}/></div></label><label><span>Producto</span><div><b>{product || "Todos los productos"}</b><Icon name="chevron" size={13}/></div></label><div className={styles.format}><span>Formato</span><div><button className={format === "xlsx" ? styles.excel : ""} onClick={() => setFormat("xlsx")}>Excel (.xlsx)</button><button className={format === "csv" ? styles.selected : ""} onClick={() => setFormat("csv")}>CSV (.csv)</button></div></div><button className={styles.downloadButton} onClick={() => go("/workspace#data-exports")}>Descargar base</button></article>

          <article className={`${styles.card} ${styles.insights}`}><header><span><Icon name="spark" size={19}/></span><h2>IA / Insights</h2></header><nav><button className={styles.selected}>Resumen</button><button>Oportunidades <b>4</b></button><button>Alertas <b>3</b></button><button>Anomalías <b>2</b></button></nav><div>{insights.map((item) => <button key={item.title}><i className={styles[item.tone]}/><span><strong>{item.title}</strong><small>{item.detail}</small></span><Icon name="chevron" size={14}/></button>)}</div><button className={styles.insightLink} onClick={() => go("/workspace#competitive")}>Ver todos los insights <Icon name="arrow" size={13}/></button></article>

          <article id="scraping" className={`${styles.card} ${styles.scraping}`}><header><div><h2>Estado del scraping</h2><p><i/> Todo operativo</p></div><button onClick={() => void load(true)}><Icon name="refresh" size={15}/></button></header><div className={styles.scrapingRows}><div><span>Retailer</span><span>Estado</span><span>Última actualización</span><span>En cola</span></div>{retailers.slice(0, 7).map((retailer, index) => <div key={retailer.supermarket}><strong>{retailer.supermarket}</strong><b>Operativo</b><small>{relative(retailer.last_updated)}</small><em>{Math.max(0, (dashboard?.run?.tasks_total ?? 0) - (dashboard?.run?.tasks_completed ?? 0) - index)}</em></div>)}</div><footer><button onClick={() => go("/workspace#retailer-overview")}>Ver todos los retailers <Icon name="arrow" size={12}/></button></footer></article>
        </aside>

        <article className={`${styles.card} ${styles.trendCard}`}>
          <header className={styles.cardHeader}><div><h2>Evolución de precios promedio <small>(índice base 100)</small></h2></div><div className={styles.periodTabs}><button className={period === 7 ? styles.selected : ""} onClick={() => setPeriod(7)}>7D</button><button className={period === 30 ? styles.selected : ""} onClick={() => setPeriod(30)}>30D</button><button className={period === 90 ? styles.selected : ""} onClick={() => setPeriod(90)}>90D</button><button>YTD</button></div></header>
          <div className={styles.seriesSelectors}><div><span>Categorías</span>{activeSeries.filter((id) => optionMap.get(id)?.kind !== "brand").map((id) => <button key={id} onClick={() => setActiveSeries((current) => current.filter((item) => item !== id))}>{optionMap.get(id)?.label ?? id} ×</button>)}<select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Agregar categoría</option>{categoryOptions.filter((item) => !activeSeries.includes(item.id)).slice(0, 100).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div><span>Marcas</span>{activeSeries.filter((id) => optionMap.get(id)?.kind === "brand").map((id) => <button key={id} onClick={() => setActiveSeries((current) => current.filter((item) => item !== id))}>{optionMap.get(id)?.label ?? id} ×</button>)}<select value="" onChange={(event) => addSeries(event.target.value)}><option value="">+ Agregar marca</option>{brandOptions.filter((item) => !activeSeries.includes(item.id)).slice(0, 100).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></div>
          <div className={styles.lineArea}>{normalizedSeries.length ? <svg viewBox={`0 0 ${lineModel.width} ${lineModel.height}`} role="img" aria-label="Evolución de precios promedio">{[0,1,2,3,4].map((index) => { const value = lineModel.max - index * (lineModel.max - lineModel.min) / 4; const y = lineModel.y(value); return <g key={index}><line x1={lineModel.margin.left} x2={lineModel.width - lineModel.margin.right} y1={y} y2={y}/><text x={lineModel.margin.left - 9} y={y + 4}>{value.toFixed(0)}</text></g>; })}{normalizedSeries.map((series) => <path key={series.id} d={lineModel.path(series.id)} stroke={series.color}/>)}{dates.filter((_, index) => index === 0 || index === dates.length - 1 || index % Math.max(1, Math.ceil(dates.length / 8)) === 0).map((date) => { const index = dates.indexOf(date); return <text key={date} className={styles.xLabel} x={lineModel.x(index)} y={lineModel.height - 8}>{new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "")}</text>; })}</svg> : <div>{loading ? "Cargando evolución…" : "Selecciona categorías o marcas para construir el gráfico."}</div>}</div>
          <footer className={styles.legend}>{normalizedSeries.map((series) => <span key={series.id}><i style={{ background: series.color }}/>{series.label}</span>)}</footer>
        </article>
      </section>

      <footer className={styles.pageFooter}><span><Icon name="database" size={14}/> Datos públicos normalizados · actualización automática</span><small>{syncing ? "Sincronizando…" : `Última captura ${relative(summary?.last_updated)}`}</small></footer>
    </main>
  </div>;
}
