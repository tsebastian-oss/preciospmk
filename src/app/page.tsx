"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Numeric = number | string;
type View = "overview" | "pricing" | "assortment" | "products" | "opportunities";

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

type CategorySummary = { supermarket: string; category: string; products: Numeric };
type CrawlRun = {
  id: number;
  status: string;
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
  products_found: number;
  source_counts: Record<string, number>;
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

type MatchListing = {
  id: string;
  supermarket: string;
  name: string;
  brand: string | null;
  price: Numeric;
  regular_price: Numeric | null;
  in_stock: boolean;
  url: string;
  image_url: string | null;
  observed_at: string;
};

type ProductMatch = {
  match_key: string;
  canonical_name: string;
  canonical_brand: string | null;
  category: string | null;
  listings: number;
  supermarkets: number;
  best_price: Numeric;
  highest_price: Numeric;
  average_price: Numeric;
  price_gap: Numeric;
  savings_pct: Numeric;
  last_updated: string;
  best_supermarket: string;
  best_url: string;
  image_url: string | null;
  store_listings: MatchListing[];
};

type MatchesPayload = {
  matches: ProductMatch[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error?: string;
};

const NAV: Array<{ view: View; label: string; hint: string }> = [
  { view: "overview", label: "Executive Overview", hint: "Mercado" },
  { view: "pricing", label: "Pricing Intelligence", hint: "Matching" },
  { view: "assortment", label: "Assortment Intelligence", hint: "Cobertura" },
  { view: "products", label: "Product Explorer", hint: "Catálogo" },
  { view: "opportunities", label: "Opportunities", hint: "Promociones" },
];

const moneyFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("es-CL");

function value(input: Numeric | null | undefined) {
  const parsed = Number(input ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(input: Numeric | null | undefined) { return moneyFormatter.format(value(input)); }
function number(input: Numeric | null | undefined) { return numberFormatter.format(value(input)); }
function percentage(input: Numeric | null | undefined) { return `${value(input).toFixed(1)}%`; }
function storeClass(name: string) { return `store-${name.toLowerCase().replace(/\s+/g, "-")}`; }
function dateTime(input: string | null | undefined) {
  if (!input) return "Sin actualización";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(input));
}

function Icon({ name }: { name: string }) {
  if (name === "arrow") return <span aria-hidden>→</span>;
  if (name === "search") return <span aria-hidden>⌕</span>;
  if (name === "refresh") return <span aria-hidden>↻</span>;
  if (name === "external") return <span aria-hidden>↗</span>;
  return <span aria-hidden>•</span>;
}

function StoreBadge({ name }: { name: string }) {
  return <span className={`store-badge ${storeClass(name)}`}><i />{name}</span>;
}

function Metric({ label, metric, detail }: { label: string; metric: string; detail: string }) {
  return <article className="metric-card">
    <span>{label}</span>
    <strong>{metric}</strong>
    <small>{detail}</small>
  </article>;
}

function ProductTable({ products, loading }: { products: Product[]; loading: boolean }) {
  if (loading) return <div className="loading-block">Actualizando productos…</div>;
  if (!products.length) return <div className="empty-block">No encontramos productos con esos filtros.</div>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Producto</th><th>Cadena</th><th>Categoría</th><th>Precio</th><th>Descuento</th><th>Stock</th><th /></tr></thead>
    <tbody>{products.map((product) => <tr key={product.id}>
      <td><div className="product-cell">
        <div className="thumb">{product.image_url ? <Image src={product.image_url} alt="" width={54} height={54} /> : "SKU"}</div>
        <div><strong>{product.name}</strong><span>{product.brand || `SKU ${product.external_id}`}</span></div>
      </div></td>
      <td><StoreBadge name={product.supermarket} /></td>
      <td><span className="category-copy">{product.category || "Sin categoría"}</span></td>
      <td><div className="price-copy"><strong>{value(product.offer_price) > 0 ? money(product.offer_price) : "Sin precio"}</strong>{value(product.regular_price) > value(product.offer_price) && <del>{money(product.regular_price)}</del>}</div></td>
      <td>{value(product.discount_pct) > 0 ? <b className="discount">-{value(product.discount_pct).toFixed(0)}%</b> : "—"}</td>
      <td><span className={product.in_stock ? "stock yes" : "stock no"}>{product.in_stock ? "Disponible" : "Sin stock"}</span></td>
      <td><a className="external" href={product.url} target="_blank" rel="noreferrer"><Icon name="external" /></a></td>
    </tr>)}</tbody>
  </table></div>;
}

function MatchingCard({ match }: { match: ProductMatch }) {
  return <article className="match-card">
    <div className="match-head">
      <div className="match-product">
        <div className="match-image">{match.image_url ? <Image src={match.image_url} alt="" width={72} height={72} /> : "MATCH"}</div>
        <div><span className="confidence">Exact match · alta confianza</span><h3>{match.canonical_name}</h3><p>{match.canonical_brand || "Marca no informada"} · {match.category || "Sin categoría"}</p></div>
      </div>
      <div className="match-saving"><span>Ahorro potencial</span><strong>{money(match.price_gap)}</strong><small>{percentage(match.savings_pct)} entre cadenas</small></div>
    </div>
    <div className="listing-grid">
      {match.store_listings.map((listing) => <a key={listing.id} href={listing.url} target="_blank" rel="noreferrer" className={`listing-card ${listing.supermarket === match.best_supermarket ? "winner" : ""}`}>
        <div><StoreBadge name={listing.supermarket} />{listing.supermarket === match.best_supermarket && <span className="best-label">Mejor precio</span>}</div>
        <strong>{money(listing.price)}</strong>
        <span>{listing.in_stock ? "Disponible" : "Sin stock"}</span>
      </a>)}
    </div>
  </article>;
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [products, setProducts] = useState<ProductsPayload>({ products: [], page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [supermarket, setSupermarket] = useState("");
  const [stock, setStock] = useState("all");
  const [sort, setSort] = useState("price_asc");
  const [productPage, setProductPage] = useState(1);
  const [matchPage, setMatchPage] = useState(1);
  const [matchSort, setMatchSort] = useState("gap_desc");
  const [minSavings, setMinSavings] = useState("0");
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = await response.json() as DashboardPayload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar la plataforma");
      setDashboard(payload);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error de carga"); }
    finally { setLoadingDashboard(false); }
  }, []);

  const loadProducts = useCallback(async () => {
    if (view !== "products" && view !== "opportunities") return;
    setLoadingProducts(true);
    const params = new URLSearchParams({ page: String(productPage), pageSize: "25", sort });
    if (appliedQuery) params.set("q", appliedQuery);
    if (supermarket) params.set("supermarket", supermarket);
    if (stock !== "all") params.set("stock", stock);
    if (view === "opportunities") params.set("offerOnly", "true");
    try {
      const response = await fetch(`/api/products?${params}`, { cache: "no-store" });
      const payload = await response.json() as ProductsPayload;
      if (!response.ok) throw new Error(payload.error || "Error cargando productos");
      setProducts(payload);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando productos"); }
    finally { setLoadingProducts(false); }
  }, [view, appliedQuery, supermarket, stock, sort, productPage]);

  const loadMatches = useCallback(async () => {
    if (view !== "pricing") return;
    setLoadingMatches(true);
    const params = new URLSearchParams({ page: String(matchPage), pageSize: "20", sort: matchSort, minSavings });
    if (appliedQuery) params.set("q", appliedQuery);
    try {
      const response = await fetch(`/api/matches?${params}`, { cache: "no-store" });
      const payload = await response.json() as MatchesPayload;
      if (!response.ok) throw new Error(payload.error || "Error cargando comparaciones");
      setMatches(payload);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando comparaciones"); }
    finally { setLoadingMatches(false); }
  }, [view, matchPage, matchSort, minSavings, appliedQuery]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as View;
    if (NAV.some((item) => item.view === hash)) setView(hash);
    void loadDashboard();
  }, [loadDashboard]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { void loadMatches(); }, [loadMatches]);

  const coverageMax = Math.max(...(dashboard?.supermarkets.map((item) => value(item.products)) ?? [1]));
  const crawlProgress = dashboard?.run?.tasks_total ? Math.round((dashboard.run.tasks_completed / dashboard.run.tasks_total) * 100) : 100;
  const topCategories = useMemo(() => (dashboard?.categories ?? []).slice(0, 12), [dashboard]);

  function navigate(next: View) {
    setView(next); window.location.hash = next; setAppliedQuery(""); setQuery(""); setProductPage(1); setMatchPage(1);
  }
  function search(event: FormEvent) { event.preventDefault(); setAppliedQuery(query.trim()); setProductPage(1); setMatchPage(1); }
  async function startCrawl() {
    setStarting(true);
    try { const response = await fetch("/api/scrape", { cache: "no-store" }); if (!response.ok) throw new Error("No fue posible iniciar la actualización"); setNotice("Actualización iniciada. Los workers continuarán procesando el catálogo."); await loadDashboard(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Error al iniciar"); }
    finally { setStarting(false); }
  }

  const summary = dashboard?.summary;
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate("overview")}><span>M</span><div><strong>MGP Retail</strong><small>Intelligence Platform</small></div></button>
      <nav>{NAV.map((item) => <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => navigate(item.view)}><span>{item.label}</span><small>{item.hint}</small></button>)}</nav>
      <div className="side-status"><div><i /><strong>{dashboard?.run?.status === "running" ? "Crawler activo" : "Data pipeline online"}</strong></div><p>{number(summary?.total_products)} SKU monitoreados</p><div className="mini-progress"><span style={{ width: `${crawlProgress}%` }} /></div></div>
    </aside>

    <main>
      {view === "overview" && <>
        <section className="hero">
          <div className="hero-copy"><span className="eyebrow">RETAIL INTELLIGENCE · CHILE</span><h1>Convierte precios públicos en decisiones comerciales.</h1><p>Monitorea surtido, disponibilidad, promociones y brechas competitivas de Lider, Jumbo y Santa Isabel desde una sola plataforma.</p><div className="hero-actions"><button className="primary" onClick={() => navigate("pricing")}>Explorar Pricing Intelligence <Icon name="arrow" /></button><button className="secondary" onClick={() => navigate("products")}>Abrir catálogo</button></div></div>
          <div className="hero-console"><div className="console-top"><span>Market pulse</span><b>LIVE</b></div><div className="console-number">{loadingDashboard ? "—" : number(summary?.total_products)}</div><p>SKU capturados en tres cadenas</p><div className="spark-bars">{dashboard?.supermarkets.map((store) => <div key={store.supermarket}><span style={{ height: `${Math.max(24, value(store.products) / coverageMax * 100)}%` }} /><small>{store.supermarket}</small></div>)}</div></div>
        </section>

        <section className="metrics"><Metric label="Productos monitoreados" metric={number(summary?.total_products)} detail="Catálogo consolidado" /><Metric label="Disponibilidad" metric={summary ? percentage(value(summary.in_stock_products) / Math.max(1, value(summary.total_products)) * 100) : "—"} detail="SKU con stock" /><Metric label="Promociones" metric={number(summary?.offers)} detail="Precio menor al regular" /><Metric label="Ahorro detectado" metric={money(summary?.total_savings)} detail="Brecha promocional acumulada" /></section>

        <section className="solution-grid">
          <button onClick={() => navigate("pricing")}><span>01</span><h2>Pricing Intelligence</h2><p>Compara productos equivalentes, detecta quién tiene el mejor precio y cuantifica la brecha.</p><b>Explorar matching →</b></button>
          <button onClick={() => navigate("assortment")}><span>02</span><h2>Assortment Intelligence</h2><p>Entiende cobertura, categorías, disponibilidad y profundidad de surtido por cadena.</p><b>Analizar cobertura →</b></button>
          <button onClick={() => navigate("opportunities")}><span>03</span><h2>Promotion Intelligence</h2><p>Identifica descuentos activos, ahorro absoluto y concentración promocional.</p><b>Ver oportunidades →</b></button>
        </section>

        <section className="dual-grid"><div className="panel"><div className="panel-head"><div><span>MARKET COVERAGE</span><h2>Cobertura por cadena</h2></div><button onClick={() => navigate("assortment")}>Ver detalle</button></div><div className="coverage-list">{dashboard?.supermarkets.map((store) => <div key={store.supermarket}><div><StoreBadge name={store.supermarket} /><strong>{number(store.products)} SKU</strong></div><div className="bar"><span className={storeClass(store.supermarket)} style={{ width: `${value(store.products) / coverageMax * 100}%` }} /></div><small>{number(store.in_stock)} disponibles · precio medio {money(store.average_price)}</small></div>)}</div></div>
          <div className="panel"><div className="panel-head"><div><span>DATA PIPELINE</span><h2>Estado de captura</h2></div><button onClick={startCrawl} disabled={starting}><Icon name="refresh" /> {starting ? "Iniciando" : "Actualizar"}</button></div><div className="pipeline"><strong>{crawlProgress}%</strong><div className="bar"><span style={{ width: `${crawlProgress}%` }} /></div><div><span>{number(dashboard?.run?.tasks_completed)} tareas completadas</span><span>{number(dashboard?.run?.tasks_failed)} errores</span></div></div></div></section>
      </>}

      {view !== "overview" && <header className="workspace-header"><div><span className="eyebrow">MGP RETAIL INTELLIGENCE</span><h1>{NAV.find((item) => item.view === view)?.label}</h1><p>{view === "pricing" ? "Productos equivalentes comparados entre cadenas con matching exacto y auditable." : view === "assortment" ? "Cobertura de surtido, disponibilidad y profundidad por cadena y categoría." : view === "products" ? "Exploración granular de cada SKU capturado en el mercado." : "Promociones y descuentos detectados en el catálogo actual."}</p></div><div className="updated"><span>Última actualización</span><strong>{dateTime(summary?.last_updated)}</strong></div></header>}

      {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {view === "pricing" && <section className="workspace">
        <div className="metrics"><Metric label="Matches exactos" metric={number(matches.total)} detail="Grupos comparables" /><Metric label="Productos visibles" metric={number(matches.matches.reduce((sum, item) => sum + item.listings, 0))} detail="En esta página" /><Metric label="Mayor brecha" metric={money(Math.max(...matches.matches.map((item) => value(item.price_gap)), 0))} detail="Diferencia absoluta" /><Metric label="Matching" metric="Alta confianza" detail="Nombre, marca y formato" /></div>
        <form className="filters" onSubmit={search}><label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o marca" /></label><select value={minSavings} onChange={(event) => { setMinSavings(event.target.value); setMatchPage(1); }}><option value="0">Cualquier brecha</option><option value="5">Ahorro ≥ 5%</option><option value="10">Ahorro ≥ 10%</option><option value="20">Ahorro ≥ 20%</option></select><select value={matchSort} onChange={(event) => { setMatchSort(event.target.value); setMatchPage(1); }}><option value="gap_desc">Mayor ahorro $</option><option value="savings_desc">Mayor ahorro %</option><option value="price_asc">Menor precio</option><option value="updated_desc">Más recientes</option><option value="name_asc">Nombre A–Z</option></select><button className="primary">Buscar</button></form>
        <div className="match-list">{loadingMatches ? <div className="loading-block">Construyendo comparaciones…</div> : matches.matches.map((match) => <MatchingCard key={match.match_key} match={match} />)}</div>
        <div className="pagination"><button disabled={matchPage <= 1} onClick={() => setMatchPage((page) => page - 1)}>Anterior</button><span>Página {matches.page} de {matches.totalPages} · {number(matches.total)} matches</span><button disabled={matchPage >= matches.totalPages} onClick={() => setMatchPage((page) => page + 1)}>Siguiente</button></div>
      </section>}

      {view === "assortment" && <section className="workspace"><div className="store-grid">{dashboard?.supermarkets.map((store) => <article key={store.supermarket} className="store-card"><StoreBadge name={store.supermarket} /><strong>{number(store.products)}</strong><span>SKU monitoreados</span><div><p><b>{number(store.in_stock)}</b> disponibles</p><p><b>{money(store.average_price)}</b> precio medio</p><p><b>{number(store.offers)}</b> promociones</p></div></article>)}</div><div className="panel"><div className="panel-head"><div><span>CATEGORY DEPTH</span><h2>Principales categorías capturadas</h2></div></div><div className="category-grid">{topCategories.map((category) => <div key={`${category.supermarket}-${category.category}`}><StoreBadge name={category.supermarket} /><strong>{category.category}</strong><span>{number(category.products)} SKU</span></div>)}</div></div></section>}

      {(view === "products" || view === "opportunities") && <section className="workspace">
        <form className="filters" onSubmit={search}><label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, marca o SKU" /></label><select value={supermarket} onChange={(event) => { setSupermarket(event.target.value); setProductPage(1); }}><option value="">Todas las cadenas</option><option>Lider</option><option>Jumbo</option><option>Santa Isabel</option></select><select value={stock} onChange={(event) => { setStock(event.target.value); setProductPage(1); }}><option value="all">Todo stock</option><option value="in">Disponible</option><option value="out">Sin stock</option></select><select value={sort} onChange={(event) => { setSort(event.target.value); setProductPage(1); }}><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="discount_desc">Mayor descuento</option><option value="newest">Más recientes</option><option value="name_asc">Nombre A–Z</option></select><button className="primary">Buscar</button></form>
        <div className="panel"><div className="panel-head"><div><span>{view === "opportunities" ? "PROMOTION MONITOR" : "CATALOG EXPLORER"}</span><h2>{number(products.total)} resultados</h2></div></div><ProductTable products={products.products} loading={loadingProducts} /><div className="pagination"><button disabled={productPage <= 1} onClick={() => setProductPage((page) => page - 1)}>Anterior</button><span>Página {products.page} de {products.totalPages}</span><button disabled={productPage >= products.totalPages} onClick={() => setProductPage((page) => page + 1)}>Siguiente</button></div></div>
      </section>}
    </main>
  </div>;
}
