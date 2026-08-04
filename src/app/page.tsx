"use client";

import Image from "next/image";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type Numeric = number | string;
type View = "overview" | "products" | "supermarkets" | "offers";

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

const NAV_ITEMS: Array<{ view: View; label: string; icon: string }> = [
  { view: "overview", label: "Resumen", icon: "grid" },
  { view: "products", label: "Productos", icon: "package" },
  { view: "supermarkets", label: "Supermercados", icon: "store" },
  { view: "offers", label: "Ofertas", icon: "tag" },
];

const VIEW_COPY: Record<View, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "INTELIGENCIA DE PRECIOS",
    title: "Resumen del mercado",
    description: "Cobertura, promociones y avance del catálogo en un solo lugar.",
  },
  products: {
    eyebrow: "CATÁLOGO CONSOLIDADO",
    title: "Explorador de productos",
    description: "Busca y filtra todos los SKU capturados en las tres cadenas.",
  },
  supermarkets: {
    eyebrow: "COMPARACIÓN POR CADENA",
    title: "Supermercados",
    description: "Compara cobertura, disponibilidad, precio medio y categorías.",
  },
  offers: {
    eyebrow: "OPORTUNIDADES",
    title: "Ofertas detectadas",
    description: "Navega productos cuyo precio actual es menor al precio regular.",
  },
};

const numberFormatter = new Intl.NumberFormat("es-CL");
const moneyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

function value(input: Numeric | null | undefined) {
  const parsed = Number(input ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function number(input: Numeric | null | undefined) {
  return numberFormatter.format(value(input));
}

function money(input: Numeric | null | undefined) {
  return moneyFormatter.format(value(input));
}

function dateTime(input: string | null | undefined) {
  if (!input) return "Sin actualización";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input));
}

function storeSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
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

  if (name === "grid") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
  if (name === "package") return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9"/></svg>;
  if (name === "store") return <svg {...common}><path d="M4 10v10h16V10M3 4h18l-1 6H4L3 4Z"/><path d="M8 20v-6h8v6M7 10a3 3 0 0 0 5 0 3 3 0 0 0 5 0"/></svg>;
  if (name === "tag") return <svg {...common}><path d="M20 13 13 20l-9-9V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1.4"/></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 9A7 7 0 0 1 18.6 6L20 11M4 13l1.4 5A7 7 0 0 0 17.9 15"/></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
  if (name === "external") return <svg {...common}><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  if (name === "activity") return <svg {...common}><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>;
  if (name === "chevron-left") return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
  if (name === "chevron-right") return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}

function StoreBadge({ name }: { name: string }) {
  return <span className={`store-badge store-${storeSlug(name)}`}><span />{name}</span>;
}

function MetricCard({
  label,
  metric,
  detail,
  icon,
  tone = "default",
}: {
  label: string;
  metric: string;
  detail: string;
  icon: string;
  tone?: string;
}) {
  return <article className={`metric-card tone-${tone}`}>
    <div className="metric-icon"><Icon name={icon} size={20}/></div>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{metric}</div>
    <div className="metric-detail">{detail}</div>
  </article>;
}

function ProductTable({
  products,
  loading = false,
  compact = false,
}: {
  products: Product[];
  loading?: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return <div className="table-loading">{Array.from({ length: compact ? 5 : 8 }, (_, index) => <div className="skeleton-row" key={index}/>)}</div>;
  }

  if (products.length === 0) {
    return <div className="empty-state">
      <div className="empty-icon"><Icon name="search" size={24}/></div>
      <strong>No encontramos productos</strong>
      <span>Prueba cambiando la búsqueda o los filtros seleccionados.</span>
    </div>;
  }

  return <div className="table-scroll">
    <table className={`products-table ${compact ? "table-compact" : ""}`}>
      <thead>
        <tr>
          <th>Producto</th>
          {!compact && <th>SKU</th>}
          <th>Supermercado</th>
          {!compact && <th>Categoría</th>}
          <th>Precio</th>
          <th>Descuento</th>
          {!compact && <th>Stock</th>}
          <th><span className="sr-only">Abrir</span></th>
        </tr>
      </thead>
      <tbody>
        {products.map((product) => {
          const discount = value(product.discount_pct);
          const hasRegularPrice = value(product.regular_price) > value(product.offer_price);
          return <tr key={product.id}>
            <td>
              <div className="product-cell">
                <div className="product-image">
                  {product.image_url
                    ? <Image src={product.image_url} alt="" width={58} height={58} sizes="58px"/>
                    : <Icon name="package" size={22}/>} 
                </div>
                <div className="product-copy">
                  <strong>{product.name}</strong>
                  <span>{product.brand || "Marca no informada"}</span>
                </div>
              </div>
            </td>
            {!compact && <td><span className="sku">{product.external_id}</span></td>}
            <td><StoreBadge name={product.supermarket}/></td>
            {!compact && <td><span className="category-text">{product.category || "Sin categoría"}</span></td>}
            <td>
              <div className="price-cell">
                <strong>{money(product.offer_price)}</strong>
                {hasRegularPrice && <del>{money(product.regular_price)}</del>}
              </div>
            </td>
            <td>{discount > 0 ? <span className="discount-pill">-{discount.toFixed(0)}%</span> : <span className="muted-dash">—</span>}</td>
            {!compact && <td><span className={`stock-pill ${product.in_stock ? "in-stock" : "out-stock"}`}>{product.in_stock ? "Disponible" : "Sin stock"}</span></td>}
            <td><a className="row-link" href={product.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${product.name}`}><Icon name="external" size={17}/></a></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("overview");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [productsPayload, setProductsPayload] = useState<ProductsPayload>({
    products: [], page: 1, pageSize: 25, total: 0, totalPages: 1,
  });
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
      setNotice(error instanceof Error ? error.message : "No fue posible cargar el dashboard");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    if (activeView !== "products" && activeView !== "offers") return;
    setProductsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "25",
        sort,
      });
      if (appliedQuery) params.set("q", appliedQuery);
      if (supermarket) params.set("supermarket", supermarket);
      if (category) params.set("category", category);
      if (stock !== "all") params.set("stock", stock);
      if (activeView === "offers") params.set("offerOnly", "true");

      const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as ProductsPayload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar los productos");
      setProductsPayload(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible cargar los productos");
    } finally {
      setProductsLoading(false);
    }
  }, [activeView, appliedQuery, category, page, sort, stock, supermarket]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as View;
    if (NAV_ITEMS.some((item) => item.view === hash)) setActiveView(hash);
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (dashboard?.run?.status !== "running") return;
    const interval = window.setInterval(() => void loadDashboard(), 15_000);
    return () => window.clearInterval(interval);
  }, [dashboard?.run?.status, loadDashboard]);

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of dashboard?.categories ?? []) {
      if (supermarket && item.supermarket !== supermarket) continue;
      totals.set(item.category, (totals.get(item.category) ?? 0) + value(item.products));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, products]) => ({ name, products }));
  }, [dashboard?.categories, supermarket]);

  const maxStoreProducts = Math.max(
    1,
    ...(dashboard?.supermarkets ?? []).map((item) => value(item.products)),
  );
  const run = dashboard?.run;
  const progress = run?.tasks_total
    ? Math.min(100, Math.round((run.tasks_completed / run.tasks_total) * 100))
    : 0;
  const copy = VIEW_COPY[activeView];

  function navigate(view: View) {
    setActiveView(view);
    setPage(1);
    if (view === "offers") setSort("discount_desc");
    if (view === "products" && sort === "discount_desc") setSort("price_asc");
    window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  function clearFilters() {
    setQuery("");
    setAppliedQuery("");
    setSupermarket("");
    setCategory("");
    setStock("all");
    setSort(activeView === "offers" ? "discount_desc" : "price_asc");
    setPage(1);
  }

  async function startCrawl() {
    setStartingCrawl(true);
    setNotice("Iniciando actualización del catálogo…");
    try {
      const response = await fetch("/api/scrape", { cache: "no-store" });
      const payload = await response.json() as { error?: string; runId?: number };
      if (!response.ok) throw new Error(payload.error || "No fue posible iniciar la actualización");
      setNotice(`Actualización activa${payload.runId ? ` · corrida #${payload.runId}` : ""}.`);
      await loadDashboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No fue posible iniciar la actualización");
    } finally {
      setStartingCrawl(false);
    }
  }

  const summary = dashboard?.summary;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span>M</span></div>
        <div><strong>MGP</strong><small>Price Intelligence</small></div>
      </div>

      <nav className="main-nav" aria-label="Navegación principal">
        {NAV_ITEMS.map((item) => <button
          type="button"
          key={item.view}
          className={activeView === item.view ? "active" : ""}
          onClick={() => navigate(item.view)}
        >
          <Icon name={item.icon}/><span>{item.label}</span>
        </button>)}
      </nav>

      <div className="sidebar-status">
        <div className="status-row"><span className={`live-dot ${run?.status === "running" ? "pulsing" : ""}`}/><strong>{run?.status === "running" ? "Actualizando" : "Sistema activo"}</strong></div>
        <p>{run?.status === "running" ? `${progress}% de la corrida procesado` : "Datos conectados a Supabase"}</p>
        {run?.status === "running" && <div className="mini-progress"><span style={{ width: `${progress}%` }}/></div>}
      </div>
    </aside>

    <main className="dashboard-main">
      <header className="topbar">
        <div>
          <div className="eyebrow">{copy.eyebrow}</div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="topbar-actions">
          <div className="last-update"><span>Última observación</span><strong>{dateTime(summary?.last_updated)}</strong></div>
          <button className="primary-button" type="button" onClick={startCrawl} disabled={startingCrawl || run?.status === "running"}>
            <Icon name="refresh" size={18}/>{startingCrawl ? "Iniciando…" : run?.status === "running" ? "Actualizando" : "Actualizar catálogo"}
          </button>
        </div>
      </header>

      {notice && <div className="notice-bar"><Icon name="activity" size={18}/><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Cerrar aviso">×</button></div>}

      {activeView === "overview" && <>
        <section className="metrics-grid" aria-label="Indicadores principales">
          <MetricCard label="SKU monitoreados" metric={dashboardLoading ? "—" : number(summary?.total_products)} detail="Catálogo real consolidado" icon="package" tone="blue"/>
          <MetricCard label="Productos disponibles" metric={dashboardLoading ? "—" : number(summary?.in_stock_products)} detail={`${summary ? Math.round((value(summary.in_stock_products) / Math.max(1, value(summary.total_products))) * 100) : 0}% con stock`} icon="check" tone="green"/>
          <MetricCard label="Ofertas activas" metric={dashboardLoading ? "—" : number(summary?.offers)} detail="Precio menor al regular" icon="tag" tone="orange"/>
          <MetricCard label="Ahorro acumulado" metric={dashboardLoading ? "—" : money(summary?.total_savings)} detail="Suma de descuentos detectados" icon="activity" tone="purple"/>
        </section>

        <section className="overview-grid">
          <article className="panel store-panel">
            <div className="panel-heading"><div><span className="panel-kicker">COBERTURA</span><h2>Catálogo por supermercado</h2></div><button className="text-button" type="button" onClick={() => navigate("supermarkets")}>Ver detalle <Icon name="arrow" size={16}/></button></div>
            <div className="store-bars">
              {(dashboard?.supermarkets ?? []).map((item) => <div className="store-bar-row" key={item.supermarket}>
                <div className="store-bar-label"><StoreBadge name={item.supermarket}/><strong>{number(item.products)} SKU</strong></div>
                <div className="bar-track"><span className={`bar-${storeSlug(item.supermarket)}`} style={{ width: `${Math.max(4, (value(item.products) / maxStoreProducts) * 100)}%` }}/></div>
                <div className="store-bar-meta"><span>{number(item.in_stock)} disponibles</span><span>{number(item.offers)} ofertas</span></div>
              </div>)}
            </div>
          </article>

          <article className="panel crawl-panel">
            <div className="panel-heading"><div><span className="panel-kicker">CRAWLER</span><h2>Estado de actualización</h2></div><span className={`run-status status-${run?.status ?? "idle"}`}>{run?.status === "running" ? "En curso" : run?.status === "completed" ? "Completada" : "Disponible"}</span></div>
            {run ? <>
              <div className="crawl-progress-copy"><strong>{progress}%</strong><span>{number(run.tasks_completed)} de {number(run.tasks_total)} tareas</span></div>
              <div className="crawl-progress"><span style={{ width: `${progress}%` }}/></div>
              <div className="crawl-stats">
                <div><span>Productos procesados</span><strong>{number(run.products_found)}</strong></div>
                <div><span>Tareas fallidas</span><strong className={run.tasks_failed ? "danger-text" : "success-text"}>{number(run.tasks_failed)}</strong></div>
              </div>
              <div className="source-list">
                {Object.entries(run.source_counts ?? {}).map(([name, count]) => <div key={name}><StoreBadge name={name}/><strong>{number(count)}</strong></div>)}
              </div>
            </> : <div className="empty-mini">Aún no hay una corrida registrada.</div>}
          </article>
        </section>

        <section className="panel offers-panel">
          <div className="panel-heading"><div><span className="panel-kicker">TOP DESCUENTOS</span><h2>Mejores ofertas detectadas</h2></div><button className="text-button" type="button" onClick={() => navigate("offers")}>Explorar ofertas <Icon name="arrow" size={16}/></button></div>
          <ProductTable products={dashboard?.topOffers ?? []} loading={dashboardLoading} compact/>
        </section>
      </>}

      {activeView === "supermarkets" && <>
        <section className="store-card-grid">
          {(dashboard?.supermarkets ?? []).map((item) => {
            const availability = Math.round((value(item.in_stock) / Math.max(1, value(item.products))) * 100);
            return <article className={`store-card store-card-${storeSlug(item.supermarket)}`} key={item.supermarket}>
              <div className="store-card-header"><StoreBadge name={item.supermarket}/><span>{dateTime(item.last_updated)}</span></div>
              <strong className="store-card-total">{number(item.products)}</strong>
              <span className="store-card-caption">SKU monitoreados</span>
              <div className="store-card-grid-inner">
                <div><span>Disponibilidad</span><strong>{availability}%</strong></div>
                <div><span>Precio promedio</span><strong>{money(item.average_price)}</strong></div>
                <div><span>Ofertas</span><strong>{number(item.offers)}</strong></div>
                <div><span>Descuento medio</span><strong>{value(item.average_discount).toFixed(1)}%</strong></div>
              </div>
              <button type="button" className="store-explore" onClick={() => { setSupermarket(item.supermarket); navigate("products"); }}>Explorar catálogo <Icon name="arrow" size={16}/></button>
            </article>;
          })}
        </section>

        <section className="panel category-panel">
          <div className="panel-heading"><div><span className="panel-kicker">ESTRUCTURA DE CATÁLOGO</span><h2>Categorías principales</h2></div></div>
          <div className="category-columns">
            {(dashboard?.supermarkets ?? []).map((store) => <div className="category-column" key={store.supermarket}>
              <StoreBadge name={store.supermarket}/>
              {(dashboard?.categories ?? []).filter((item) => item.supermarket === store.supermarket).slice(0, 10).map((item) => <button type="button" key={`${store.supermarket}-${item.category}`} onClick={() => { setSupermarket(store.supermarket); setCategory(item.category); navigate("products"); }}><span>{item.category}</span><strong>{number(item.products)}</strong></button>)}
            </div>)}
          </div>
        </section>
      </>}

      {(activeView === "products" || activeView === "offers") && <>
        <section className="panel filters-panel">
          <form className="filters-grid" onSubmit={submitSearch}>
            <label className="search-field"><span>Buscar producto, marca o SKU</span><div><Icon name="search" size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej: leche, Coca-Cola, 780..."/></div></label>
            <label><span>Supermercado</span><select value={supermarket} onChange={(event) => { setSupermarket(event.target.value); setCategory(""); setPage(1); }}><option value="">Todos</option><option value="Lider">Lider</option><option value="Jumbo">Jumbo</option><option value="Santa Isabel">Santa Isabel</option></select></label>
            <label><span>Categoría</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">Todas</option>{categories.map((item) => <option value={item.name} key={item.name}>{item.name} ({number(item.products)})</option>)}</select></label>
            <label><span>Disponibilidad</span><select value={stock} onChange={(event) => { setStock(event.target.value); setPage(1); }}><option value="all">Todo el catálogo</option><option value="in">Con stock</option><option value="out">Sin stock</option></select></label>
            <label><span>Ordenar por</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="discount_desc">Mayor descuento</option><option value="newest">Actualización reciente</option><option value="name_asc">Nombre A–Z</option></select></label>
            <div className="filter-actions"><button className="primary-button" type="submit"><Icon name="search" size={17}/>Buscar</button><button className="secondary-button" type="button" onClick={clearFilters}>Limpiar</button></div>
          </form>
        </section>

        <section className="panel catalog-panel">
          <div className="catalog-heading">
            <div><span className="panel-kicker">{activeView === "offers" ? "PROMOCIONES" : "RESULTADOS"}</span><h2>{productsLoading ? "Cargando catálogo…" : `${number(productsPayload.total)} productos`}</h2><p>Página {productsPayload.page} de {productsPayload.totalPages}</p></div>
            {(appliedQuery || supermarket || category || stock !== "all") && <div className="active-filters">{appliedQuery && <span>“{appliedQuery}”</span>}{supermarket && <span>{supermarket}</span>}{category && <span>{category}</span>}{stock !== "all" && <span>{stock === "in" ? "Con stock" : "Sin stock"}</span>}</div>}
          </div>
          <ProductTable products={productsPayload.products} loading={productsLoading}/>
          <div className="pagination">
            <button type="button" className="secondary-button" disabled={page <= 1 || productsLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}><Icon name="chevron-left" size={17}/>Anterior</button>
            <span>Mostrando {productsPayload.total === 0 ? 0 : ((productsPayload.page - 1) * productsPayload.pageSize) + 1}–{Math.min(productsPayload.page * productsPayload.pageSize, productsPayload.total)} de {number(productsPayload.total)}</span>
            <button type="button" className="secondary-button" disabled={page >= productsPayload.totalPages || productsLoading} onClick={() => setPage((current) => Math.min(productsPayload.totalPages, current + 1))}>Siguiente<Icon name="chevron-right" size={17}/></button>
          </div>
        </section>
      </>}
    </main>
  </div>;
}
