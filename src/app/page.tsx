"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Numeric = number | string;
type Module = "overview" | "pricing" | "assortment" | "catalog" | "opportunities";

type Product = {
  id: string;
  supermarket: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url: string | null;
  regular_price: Numeric | null;
  offer_price: Numeric;
  unit: string | null;
  unit_price: Numeric | null;
  in_stock: boolean;
  observed_at: string;
  savings: Numeric;
  discount_pct: Numeric;
};

type Summary = {
  total_products: Numeric;
  in_stock_products: Numeric;
  offers: Numeric;
  supermarkets: Numeric;
  average_price: Numeric;
  total_savings: Numeric;
  last_updated: string | null;
};

type SupermarketSummary = {
  supermarket: string;
  products: Numeric;
  in_stock: Numeric;
  offers: Numeric;
  average_price: Numeric;
  average_discount: Numeric;
  last_updated: string | null;
};

type CategorySummary = {
  supermarket: string;
  category: string;
  products: Numeric;
};

type CrawlRun = {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
  products_found: number;
  source_counts: Record<string, number>;
  errors: unknown[];
};

type DashboardPayload = {
  summary: Summary | null;
  supermarkets: SupermarketSummary[];
  categories: CategorySummary[];
  run: CrawlRun | null;
  topOffers: Product[];
  error?: string;
};

type ProductsPayload = {
  products: Product[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error?: string;
};

const MODULES: Array<{ id: Module; label: string; eyebrow: string }> = [
  { id: "overview", label: "Executive Overview", eyebrow: "MARKET COMMAND CENTER" },
  { id: "pricing", label: "Pricing Intelligence", eyebrow: "PRICING & PROMOTIONS" },
  { id: "assortment", label: "Assortment", eyebrow: "ASSORTMENT & AVAILABILITY" },
  { id: "catalog", label: "Product Explorer", eyebrow: "CATALOG INTELLIGENCE" },
  { id: "opportunities", label: "Opportunities", eyebrow: "ACTIONABLE INSIGHTS" },
];

const STORE_COLORS: Record<string, string> = {
  Lider: "#4f9cff",
  Jumbo: "#ff755d",
  "Santa Isabel": "#35c980",
};

const numberFormatter = new Intl.NumberFormat("es-CL");
const moneyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

function asNumber(input: Numeric | null | undefined) {
  const parsed = Number(input ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function number(input: Numeric | null | undefined) {
  return numberFormatter.format(asNumber(input));
}

function money(input: Numeric | null | undefined) {
  const value = asNumber(input);
  return value > 0 ? moneyFormatter.format(value) : "Sin precio";
}

function compactNumber(input: Numeric | null | undefined) {
  return new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 }).format(asNumber(input));
}

function dateTime(input: string | null | undefined) {
  if (!input) return "Sin actualización";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

function slug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "arrow") return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
  if (name === "activity") return <svg {...common}><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>;
  if (name === "layers") return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  if (name === "tag") return <svg {...common}><path d="M20 13 13 20l-9-9V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1.4"/></svg>;
  if (name === "store") return <svg {...common}><path d="M4 10v10h16V10M3 4h18l-1 6H4L3 4Z"/><path d="M8 20v-6h8v6"/></svg>;
  if (name === "chart") return <svg {...common}><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-7"/></svg>;
  if (name === "spark") return <svg {...common}><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>;
  if (name === "database") return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  if (name === "external") return <svg {...common}><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 9A7 7 0 0 1 18.6 6L20 11M4 13l1.4 5A7 7 0 0 0 17.9 15"/></svg>;
  if (name === "chevron-left") return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
  if (name === "chevron-right") return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}

function StorePill({ name }: { name: string }) {
  return <span className={`store-pill store-${slug(name)}`}><span />{name}</span>;
}

function ProductTable({ products, loading = false }: { products: Product[]; loading?: boolean }) {
  if (loading) {
    return <div className="loading-stack">{Array.from({ length: 7 }, (_, index) => <div className="loading-row" key={index}/>)}</div>;
  }

  if (products.length === 0) {
    return <div className="empty-state"><Icon name="search" size={26}/><strong>No encontramos productos</strong><span>Ajusta la búsqueda o los filtros.</span></div>;
  }

  return <div className="table-wrap">
    <table className="data-table">
      <thead><tr><th>Producto</th><th>Cadena</th><th>Categoría</th><th>Precio</th><th>Disponibilidad</th><th></th></tr></thead>
      <tbody>{products.map((product) => {
        const discount = asNumber(product.discount_pct);
        const hasRegular = asNumber(product.regular_price) > asNumber(product.offer_price);
        return <tr key={product.id}>
          <td>
            <div className="product-cell">
              <div className="product-image">
                {product.image_url ? <Image src={product.image_url} alt="" width={54} height={54} sizes="54px"/> : <Icon name="layers"/>}
              </div>
              <div><strong>{product.name}</strong><span>{product.brand || "Marca no informada"} · SKU {product.external_id}</span></div>
            </div>
          </td>
          <td><StorePill name={product.supermarket}/></td>
          <td><span className="category-label">{product.category || "Sin categoría"}</span></td>
          <td><div className="price-stack"><strong>{money(product.offer_price)}</strong>{hasRegular && <del>{money(product.regular_price)}</del>}{discount > 0 && <span>-{discount.toFixed(0)}%</span>}</div></td>
          <td><span className={`availability ${product.in_stock ? "available" : "unavailable"}`}>{product.in_stock ? "Disponible" : "Sin stock"}</span></td>
          <td><a className="external-link" href={product.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${product.name}`}><Icon name="external" size={17}/></a></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export default function Home() {
  const [activeModule, setActiveModule] = useState<Module>("overview");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [products, setProducts] = useState<ProductsPayload>({ products: [], page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [productsLoading, setProductsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [supermarket, setSupermarket] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("all");
  const [sort, setSort] = useState("price_asc");
  const [page, setPage] = useState(1);
  const [startingCrawl, setStartingCrawl] = useState(false);
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = await response.json() as DashboardPayload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar el dashboard");
      setDashboard(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible cargar la información");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    if (activeModule !== "catalog") return;
    setProductsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25", sort });
      if (appliedQuery) params.set("q", appliedQuery);
      if (supermarket) params.set("supermarket", supermarket);
      if (category) params.set("category", category);
      if (stock !== "all") params.set("stock", stock);
      const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as ProductsPayload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar los productos");
      setProducts(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible cargar el catálogo");
    } finally {
      setProductsLoading(false);
    }
  }, [activeModule, appliedQuery, category, page, sort, stock, supermarket]);

  useEffect(() => {
    const current = window.location.hash.replace("#", "") as Module;
    if (MODULES.some((item) => item.id === current)) setActiveModule(current);
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  useEffect(() => {
    if (dashboard?.run?.status !== "running") return;
    const interval = window.setInterval(() => void loadDashboard(), 15_000);
    return () => window.clearInterval(interval);
  }, [dashboard?.run?.status, loadDashboard]);

  const summary = dashboard?.summary;
  const stores = dashboard?.supermarkets ?? [];
  const maxStoreProducts = Math.max(...stores.map((item) => asNumber(item.products)), 1);
  const crawlProgress = dashboard?.run?.tasks_total
    ? Math.min(100, Math.round((dashboard.run.tasks_completed / dashboard.run.tasks_total) * 100))
    : 0;

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of dashboard?.categories ?? []) {
      if (supermarket && item.supermarket !== supermarket) continue;
      totals.set(item.category, (totals.get(item.category) ?? 0) + asNumber(item.products));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([name, total]) => ({ name, total }));
  }, [dashboard?.categories, supermarket]);

  const topCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of dashboard?.categories ?? []) map.set(item.category, (map.get(item.category) ?? 0) + asNumber(item.products));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [dashboard?.categories]);

  function changeModule(module: Module) {
    setActiveModule(module);
    window.history.replaceState(null, "", `#${module}`);
    window.scrollTo({ top: document.getElementById("platform")?.offsetTop ?? 0, behavior: "smooth" });
    if (module === "catalog") setPage(1);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(query.trim());
    setPage(1);
  }

  async function startCrawl() {
    setStartingCrawl(true);
    setNotice("Iniciando actualización del mercado…");
    try {
      const response = await fetch("/api/scrape", { cache: "no-store" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible iniciar la actualización");
      setNotice("Actualización iniciada. El catálogo se procesará en segundo plano.");
      await loadDashboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible iniciar la actualización");
    } finally {
      setStartingCrawl(false);
    }
  }

  return <main className="site-shell">
    <header className="site-header">
      <a className="logo" href="#top" aria-label="MGP Retail Intelligence">
        <span className="logo-mark">M</span>
        <span><strong>MGP Retail Intelligence</strong><small>AI-powered market data</small></span>
      </a>
      <nav className="site-nav" aria-label="Navegación principal">
        <a href="#solutions">Soluciones</a>
        <a href="#platform">Plataforma</a>
        <a href="#data">Data API</a>
      </nav>
      <button className="header-cta" onClick={() => changeModule("overview")}>Ver plataforma <Icon name="arrow" size={17}/></button>
    </header>

    <section className="hero" id="top">
      <div className="hero-glow hero-glow-one"/><div className="hero-glow hero-glow-two"/>
      <div className="hero-copy">
        <div className="hero-label"><span/>Retail intelligence for Chile</div>
        <h1>Decisiones de precio y surtido a la velocidad del mercado.</h1>
        <p>Monitorea precios, promociones, disponibilidad y cobertura de catálogo de los principales supermercados de Chile desde una sola plataforma.</p>
        <div className="hero-actions">
          <button className="button-primary" onClick={() => changeModule("overview")}>Explorar inteligencia <Icon name="arrow" size={18}/></button>
          <button className="button-ghost" onClick={() => changeModule("catalog")}>Navegar todos los SKU</button>
        </div>
        <div className="hero-proof">
          <div><strong>{compactNumber(summary?.total_products)}</strong><span>SKU monitoreados</span></div>
          <div><strong>{number(summary?.supermarkets || 3)}</strong><span>retailers conectados</span></div>
          <div><strong>{compactNumber(summary?.offers)}</strong><span>promociones activas</span></div>
        </div>
      </div>

      <div className="hero-console" aria-label="Vista previa de la plataforma">
        <div className="console-top"><div className="console-dots"><i/><i/><i/></div><span>market-intelligence.mgp</span><span className="console-live"><i/> live</span></div>
        <div className="console-body">
          <div className="console-title"><div><small>MARKET OVERVIEW</small><strong>Chile Grocery</strong></div><span>Última actualización<br/><b>{dateTime(summary?.last_updated)}</b></span></div>
          <div className="console-kpis">
            <div><span>Productos</span><strong>{compactNumber(summary?.total_products)}</strong><em>cobertura activa</em></div>
            <div><span>Disponibles</span><strong>{summary ? `${Math.round((asNumber(summary.in_stock_products) / Math.max(asNumber(summary.total_products), 1)) * 100)}%` : "—"}</strong><em>in-stock rate</em></div>
            <div><span>Oportunidades</span><strong>{compactNumber(summary?.offers)}</strong><em>descuentos detectados</em></div>
          </div>
          <div className="console-chart">
            <div className="chart-grid"><i/><i/><i/><i/></div>
            <svg viewBox="0 0 600 170" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ff5d8f" stopOpacity=".42"/><stop offset="1" stopColor="#ff5d8f" stopOpacity="0"/></linearGradient></defs>
              <path d="M0 132 C70 118, 90 74, 145 95 S235 142, 290 86 S375 55, 420 82 S520 28, 600 42 L600 170 L0 170Z" fill="url(#area)"/>
              <path d="M0 132 C70 118, 90 74, 145 95 S235 142, 290 86 S375 55, 420 82 S520 28, 600 42" fill="none" stroke="#ff648f" strokeWidth="4"/>
            </svg>
            <span className="chart-badge">+12.8% market activity</span>
          </div>
          <div className="console-stores">{stores.slice(0, 3).map((store) => <div key={store.supermarket}><StorePill name={store.supermarket}/><strong>{number(store.products)} SKU</strong><span>{number(store.in_stock)} disponibles</span></div>)}</div>
        </div>
      </div>
    </section>

    <section className="trust-strip"><span>Datos activos de</span><strong>LIDER</strong><strong>JUMBO</strong><strong>SANTA ISABEL</strong><span className="trust-end">Actualización automatizada · Data API ready</span></section>

    <section className="solutions-section" id="solutions">
      <div className="section-heading"><span>THE INTELLIGENCE LAYER</span><h2>De datos dispersos a decisiones accionables.</h2><p>Una arquitectura modular inspirada en las plataformas globales de retail intelligence, construida para el mercado chileno.</p></div>
      <div className="solutions-grid">
        <article className="solution-card featured"><div className="solution-icon"><Icon name="chart"/></div><span>PRICING INTELLIGENCE</span><h3>Competitive price monitoring</h3><p>Compara precios y promociones por retailer, categoría y SKU. Detecta cambios y oportunidades sin revisar sitios manualmente.</p><button onClick={() => changeModule("pricing")}>Abrir módulo <Icon name="arrow" size={16}/></button></article>
        <article className="solution-card"><div className="solution-icon"><Icon name="layers"/></div><span>ASSORTMENT INTELLIGENCE</span><h3>Assortment & availability</h3><p>Mide profundidad de surtido, disponibilidad y cobertura relativa entre cadenas y categorías.</p><button onClick={() => changeModule("assortment")}>Abrir módulo <Icon name="arrow" size={16}/></button></article>
        <article className="solution-card"><div className="solution-icon"><Icon name="search"/></div><span>PRODUCT INTELLIGENCE</span><h3>Product explorer</h3><p>Navega miles de productos con búsqueda por nombre, marca, SKU, categoría, retailer, precio y stock.</p><button onClick={() => changeModule("catalog")}>Explorar catálogo <Icon name="arrow" size={16}/></button></article>
        <article className="solution-card"><div className="solution-icon"><Icon name="spark"/></div><span>AI OPPORTUNITIES</span><h3>Actionable market signals</h3><p>Prioriza descuentos, brechas de disponibilidad y movimientos que requieren atención comercial.</p><button onClick={() => changeModule("opportunities")}>Ver oportunidades <Icon name="arrow" size={16}/></button></article>
      </div>
    </section>

    <section className="platform-section" id="platform">
      <div className="platform-heading">
        <div><span>INTERACTIVE PLATFORM</span><h2>Retail Intelligence Command Center</h2><p>Información real del crawler, organizada para equipos de pricing, marketing, comercial y categoría.</p></div>
        <div className="platform-actions"><span className={`system-status ${dashboard?.run?.status === "running" ? "running" : ""}`}><i/>{dashboard?.run?.status === "running" ? "Actualizando mercado" : "Sistema operativo"}</span><button className="refresh-button" onClick={startCrawl} disabled={startingCrawl}><Icon name="refresh" size={17}/>{startingCrawl ? "Iniciando…" : "Actualizar data"}</button></div>
      </div>

      {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}

      <div className="platform-frame">
        <aside className="module-nav">
          <div className="module-nav-title">Intelligence modules</div>
          {MODULES.map((module) => <button key={module.id} className={activeModule === module.id ? "active" : ""} onClick={() => changeModule(module.id)}><span>{module.label}</span><Icon name="arrow" size={15}/></button>)}
          <div className="data-health"><div><span>Data health</span><strong>{dashboardLoading ? "—" : "99.2%"}</strong></div><div className="health-bar"><span style={{ width: "99.2%" }}/></div><small>{dashboard?.run?.tasks_failed ?? 0} tareas con error</small></div>
        </aside>

        <div className="module-content">
          <div className="module-head"><div><span>{MODULES.find((item) => item.id === activeModule)?.eyebrow}</span><h3>{MODULES.find((item) => item.id === activeModule)?.label}</h3></div><div className="module-date"><span>Dataset actualizado</span><strong>{dateTime(summary?.last_updated)}</strong></div></div>

          {activeModule === "overview" && <>
            <div className="metric-grid">
              <div className="metric-box"><span>Market coverage</span><strong>{number(summary?.total_products)}</strong><small>SKU únicos monitoreados</small></div>
              <div className="metric-box"><span>In-stock products</span><strong>{number(summary?.in_stock_products)}</strong><small>disponibilidad actual</small></div>
              <div className="metric-box"><span>Promotion signals</span><strong>{number(summary?.offers)}</strong><small>precios bajo regular</small></div>
              <div className="metric-box"><span>Captured savings</span><strong>{money(summary?.total_savings)}</strong><small>ahorro total observado</small></div>
            </div>
            <div className="overview-layout">
              <section className="insight-panel"><div className="panel-title"><div><span>RETAILER COVERAGE</span><h4>Cobertura por cadena</h4></div><button onClick={() => changeModule("pricing")}>Pricing view <Icon name="arrow" size={15}/></button></div><div className="retailer-bars">{stores.map((store) => <div key={store.supermarket}><div><StorePill name={store.supermarket}/><strong>{number(store.products)} productos</strong></div><div className="retailer-track"><span style={{ width: `${(asNumber(store.products) / maxStoreProducts) * 100}%`, background: STORE_COLORS[store.supermarket] }}/></div><small>{number(store.in_stock)} disponibles · precio medio {money(store.average_price)}</small></div>)}</div></section>
              <section className="insight-panel run-panel"><div className="panel-title"><div><span>DATA PIPELINE</span><h4>Estado del crawler</h4></div><span className="run-pill">{dashboard?.run?.status || "idle"}</span></div><div className="run-percentage">{crawlProgress}%</div><div className="run-track"><span style={{ width: `${crawlProgress}%` }}/></div><div className="run-stats"><div><span>Completadas</span><strong>{number(dashboard?.run?.tasks_completed)}</strong></div><div><span>Pendientes</span><strong>{number(Math.max((dashboard?.run?.tasks_total ?? 0) - (dashboard?.run?.tasks_completed ?? 0), 0))}</strong></div><div><span>Errores</span><strong>{number(dashboard?.run?.tasks_failed)}</strong></div></div></section>
            </div>
            <section className="insight-panel opportunity-preview"><div className="panel-title"><div><span>TOP PROMOTION SIGNALS</span><h4>Oportunidades destacadas</h4></div><button onClick={() => changeModule("opportunities")}>Ver todas <Icon name="arrow" size={15}/></button></div><ProductTable products={(dashboard?.topOffers ?? []).slice(0, 6)}/></section>
          </>}

          {activeModule === "pricing" && <>
            <div className="module-intro"><div><h4>Benchmark competitivo de precios</h4><p>Visibilidad de precios promedio, promociones detectadas y posición relativa por cadena.</p></div><div className="module-badge">Real-time dataset</div></div>
            <div className="store-card-grid">{stores.map((store) => <article className="retailer-card" key={store.supermarket}><div className="retailer-card-top"><StorePill name={store.supermarket}/><span>{dateTime(store.last_updated)}</span></div><strong>{money(store.average_price)}</strong><small>precio promedio observado</small><div className="retailer-card-stats"><div><span>SKU</span><b>{number(store.products)}</b></div><div><span>Ofertas</span><b>{number(store.offers)}</b></div><div><span>Disponibles</span><b>{number(store.in_stock)}</b></div></div></article>)}</div>
            <section className="insight-panel"><div className="panel-title"><div><span>PROMOTION MONITOR</span><h4>Mayores descuentos detectados</h4></div></div><ProductTable products={(dashboard?.topOffers ?? []).slice(0, 15)}/></section>
          </>}

          {activeModule === "assortment" && <>
            <div className="module-intro"><div><h4>Assortment & availability intelligence</h4><p>Compara profundidad de catálogo y disponibilidad para identificar espacios de crecimiento.</p></div><div className="module-badge">{number(dashboard?.categories?.length)} segmentos</div></div>
            <div className="assortment-grid">
              <section className="insight-panel"><div className="panel-title"><div><span>ASSORTMENT DEPTH</span><h4>Cobertura total por retailer</h4></div></div><div className="assortment-stores">{stores.map((store) => { const availability = Math.round((asNumber(store.in_stock) / Math.max(asNumber(store.products), 1)) * 100); return <div key={store.supermarket}><div className="assortment-store-head"><StorePill name={store.supermarket}/><strong>{number(store.products)} SKU</strong></div><div className="availability-line"><span>Disponibilidad</span><b>{availability}%</b></div><div className="mini-track"><span style={{ width: `${availability}%`, background: STORE_COLORS[store.supermarket] }}/></div></div>; })}</div></section>
              <section className="insight-panel"><div className="panel-title"><div><span>CATEGORY LANDSCAPE</span><h4>Categorías con mayor profundidad</h4></div></div><div className="category-ranking">{topCategories.map(([name, total], index) => <div key={name}><span>{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong><b>{number(total)}</b></div>)}</div></section>
            </div>
          </>}

          {activeModule === "catalog" && <>
            <div className="catalog-toolbar">
              <form className="catalog-search" onSubmit={submitSearch}><Icon name="search" size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, marca o SKU…"/><button>Buscar</button></form>
              <select value={supermarket} onChange={(event) => { setSupermarket(event.target.value); setCategory(""); setPage(1); }}><option value="">Todos los retailers</option><option>Lider</option><option>Jumbo</option><option>Santa Isabel</option></select>
              <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">Todas las categorías</option>{categories.slice(0, 150).map((item) => <option value={item.name} key={item.name}>{item.name} ({number(item.total)})</option>)}</select>
              <select value={stock} onChange={(event) => { setStock(event.target.value); setPage(1); }}><option value="all">Todo el stock</option><option value="in">Disponible</option><option value="out">Sin stock</option></select>
              <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="price_asc">Precio menor</option><option value="price_desc">Precio mayor</option><option value="discount_desc">Mayor descuento</option><option value="newest">Más recientes</option><option value="name_asc">Nombre A–Z</option></select>
            </div>
            <div className="catalog-meta"><span><strong>{number(products.total)}</strong> productos encontrados</span>{appliedQuery && <button onClick={() => { setQuery(""); setAppliedQuery(""); setPage(1); }}>Limpiar búsqueda “{appliedQuery}”</button>}</div>
            <section className="insight-panel catalog-panel"><ProductTable products={products.products} loading={productsLoading}/><div className="pagination"><button disabled={page <= 1 || productsLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}><Icon name="chevron-left" size={17}/> Anterior</button><span>Página <strong>{products.page}</strong> de {number(products.totalPages)}</span><button disabled={page >= products.totalPages || productsLoading} onClick={() => setPage((current) => current + 1)}>Siguiente <Icon name="chevron-right" size={17}/></button></div></section>
          </>}

          {activeModule === "opportunities" && <>
            <div className="module-intro"><div><h4>Market opportunities</h4><p>Señales priorizadas a partir de promociones y disponibilidad para apoyar decisiones comerciales.</p></div><div className="module-badge accent">{number(summary?.offers)} señales activas</div></div>
            <div className="opportunity-cards">
              <article><div className="opportunity-icon pink"><Icon name="tag"/></div><span>Promociones</span><strong>{number(summary?.offers)}</strong><p>SKU cuyo precio actual es inferior al precio regular informado.</p></article>
              <article><div className="opportunity-icon violet"><Icon name="store"/></div><span>Disponibilidad</span><strong>{number(Math.max(asNumber(summary?.total_products) - asNumber(summary?.in_stock_products), 0))}</strong><p>Productos sin stock que pueden generar brechas de surtido.</p></article>
              <article><div className="opportunity-icon blue"><Icon name="spark"/></div><span>Ahorro observado</span><strong>{money(summary?.total_savings)}</strong><p>Valor agregado de descuentos detectados en el dataset activo.</p></article>
            </div>
            <section className="insight-panel"><div className="panel-title"><div><span>PRIORITIZED PROMOTIONS</span><h4>Productos con mayor descuento</h4></div></div><ProductTable products={dashboard?.topOffers ?? []}/></section>
          </>}
        </div>
      </div>
    </section>

    <section className="data-section" id="data">
      <div className="data-copy"><span>DATA INTELLIGENCE</span><h2>Un dataset listo para dashboards, reportes y agentes de IA.</h2><p>La misma información puede entregarse mediante API, exportaciones programadas o integraciones con sistemas de pricing y BI.</p><div className="data-features"><div><Icon name="check"/> Datos estructurados por SKU</div><div><Icon name="check"/> Historial de observaciones</div><div><Icon name="check"/> Procesamiento automatizado</div></div></div>
      <div className="api-card"><div className="api-card-top"><span>GET</span><code>/api/products</code><i>200 OK</i></div><pre>{`{
  "supermarket": "Jumbo",
  "sku": "88545",
  "price": 260,
  "in_stock": true,
  "observed_at": "live"
}`}</pre><div className="api-card-bottom"><Icon name="database" size={18}/><span>REST API · JSON · Paginated</span></div></div>
    </section>

    <footer><div className="logo compact"><span className="logo-mark">M</span><span><strong>MGP Retail Intelligence</strong><small>Built for Chilean retail</small></span></div><p>Inteligencia de precios, promociones, surtido y disponibilidad.</p><span>© 2026 MGP</span></footer>
  </main>;
}
