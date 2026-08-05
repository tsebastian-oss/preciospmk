"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import BrandWorld, { type BrandView } from "./BrandWorld";
import CompetitiveWorkspace from "./CompetitiveWorkspace";
import RetailerDecisionWorkspace, { type RetailerDecisionView } from "./RetailerDecisionWorkspace";
import styles from "./platform-dashboard.module.css";

type Numeric = number | string;
type World = "retailer" | "brand";
type RetailerView =
  | "retailer-overview"
  | "price-image"
  | "price-matching"
  | "competitive"
  | "promotions"
  | "assortment-gaps"
  | "price-movements"
  | "basket-simulator"
  | "products";
type View = RetailerView | BrandView;

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

type NavMeta = { label: string; description: string; world: World };

const NAV: Record<View, NavMeta> = {
  "retailer-overview": { label: "Retailer Executive Overview", description: "Visión ejecutiva de competitividad, catálogo, promociones y disponibilidad.", world: "retailer" },
  "price-image": { label: "Price Image Index", description: "Índice de percepción de precio por cadena y categoría. Mercado = 100.", world: "retailer" },
  "price-matching": { label: "Price Matching", description: "Productos equivalentes comparados entre cadenas con matching exacto y auditable.", world: "retailer" },
  competitive: { label: "Competitive Analysis", description: "Set competitivo, posición de precio y recomendaciones ejecutivas potenciadas por IA.", world: "retailer" },
  promotions: { label: "Promotion Intelligence", description: "Descuentos activos, profundidad promocional y calidad de precio efectivo.", world: "retailer" },
  "assortment-gaps": { label: "Assortment Gaps", description: "Brechas comparables de surtido, distribución y profundidad por categoría.", world: "retailer" },
  "price-movements": { label: "Price Movements", description: "Cambios de precio, reacción competitiva y variaciones de disponibilidad entre corridas.", world: "retailer" },
  "basket-simulator": { label: "Basket Simulator", description: "Comparación del costo total de canastas equivalentes por cadena.", world: "retailer" },
  products: { label: "Product Explorer", description: "Exploración granular del catálogo público monitoreado.", world: "retailer" },
  "brand-overview": { label: "Brand Executive Overview", description: "Salud comercial de la marca a través de todos los retailers monitoreados.", world: "brand" },
  "digital-shelf": { label: "Digital Shelf", description: "Presencia, contenido, disponibilidad y calidad de ejecución digital.", world: "brand" },
  "brand-pricing": { label: "Pricing & Promotions", description: "Prima de precio, presión promocional y consistencia entre retailers.", world: "brand" },
  availability: { label: "Distribution & Availability", description: "Distribución digital, quiebres de stock y referencias ausentes.", world: "brand" },
  benchmark: { label: "Competitor Benchmark", description: "Comparación de portafolio, disponibilidad, promoción y precio con marcas rivales.", world: "brand" },
  scorecards: { label: "Retailer Scorecards", description: "Evaluación consolidada de la ejecución de la marca por cadena.", world: "brand" },
  "launch-tracker": { label: "Launch Tracker", description: "Seguimiento de nuevos SKU, aparición pública y evolución por retailer.", world: "brand" },
};

const RETAILER_VIEWS = Object.entries(NAV).filter(([, item]) => item.world === "retailer").map(([view]) => view as RetailerView);
const BRAND_VIEWS = Object.entries(NAV).filter(([, item]) => item.world === "brand").map(([view]) => view as BrandView);
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
  return <article className="metric-card"><span>{label}</span><strong>{metric}</strong><small>{detail}</small></article>;
}

function ProductTable({ products, loading }: { products: Product[]; loading: boolean }) {
  if (loading) return <div className="loading-block">Actualizando productos…</div>;
  if (!products.length) return <div className="empty-block">No encontramos productos con esos filtros.</div>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Producto</th><th>Cadena</th><th>Categoría</th><th>Precio</th><th>Descuento</th><th>Stock</th><th /></tr></thead>
    <tbody>{products.map((product) => <tr key={product.id}>
      <td><div className="product-cell"><div className="thumb">{product.image_url ? <Image src={product.image_url} alt="" width={54} height={54} /> : "SKU"}</div><div><strong>{product.name}</strong><span>{product.brand || `SKU ${product.external_id}`}</span></div></div></td>
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
  return <article className="match-card"><div className="match-head"><div className="match-product"><div className="match-image">{match.image_url ? <Image src={match.image_url} alt="" width={72} height={72} /> : "MATCH"}</div><div><span className="confidence">Exact match · alta confianza</span><h3>{match.canonical_name}</h3><p>{match.canonical_brand || "Marca no informada"} · {match.category || "Sin categoría"}</p></div></div><div className="match-saving"><span>Ahorro potencial</span><strong>{money(match.price_gap)}</strong><small>{percentage(match.savings_pct)} entre cadenas</small></div></div><div className="listing-grid">{match.store_listings.map((listing) => <a key={listing.id} href={listing.url} target="_blank" rel="noreferrer" className={`listing-card ${listing.supermarket === match.best_supermarket ? "winner" : ""}`}><div><StoreBadge name={listing.supermarket} />{listing.supermarket === match.best_supermarket && <span className="best-label">Mejor precio</span>}</div><strong>{money(listing.price)}</strong><span>{listing.in_stock ? "Disponible" : "Sin stock"}</span></a>)}</div></article>;
}

export default function PlatformDashboard() {
  const [world, setWorld] = useState<World>("retailer");
  const [view, setView] = useState<View>("retailer-overview");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [products, setProducts] = useState<ProductsPayload>({ products: [], page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [matches, setMatches] = useState<MatchesPayload>({ matches: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
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
    if (view !== "products" && view !== "promotions") return;
    setLoadingProducts(true);
    const params = new URLSearchParams({ page: String(productPage), pageSize: "25", sort });
    if (appliedQuery) params.set("q", appliedQuery);
    if (supermarket) params.set("supermarket", supermarket);
    if (stock !== "all") params.set("stock", stock);
    if (view === "promotions") params.set("offerOnly", "true");
    try {
      const response = await fetch(`/api/products?${params}`, { cache: "no-store" });
      const payload = await response.json() as ProductsPayload;
      if (!response.ok) throw new Error(payload.error || "Error cargando productos");
      setProducts(payload);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error cargando productos"); }
    finally { setLoadingProducts(false); }
  }, [view, appliedQuery, supermarket, stock, sort, productPage]);

  const loadMatches = useCallback(async () => {
    if (!["price-matching", "price-image", "basket-simulator"].includes(view)) return;
    setLoadingMatches(true);
    const params = new URLSearchParams({ page: String(matchPage), pageSize: "50", sort: matchSort, minSavings });
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
    if (hash && hash in NAV) {
      setView(hash);
      setWorld(NAV[hash].world);
    } else {
      const savedWorld = window.localStorage.getItem("mgp-intelligence-world") as World | null;
      if (savedWorld === "brand") {
        setWorld("brand");
        setView("brand-overview");
      }
    }
    void loadDashboard();
  }, [loadDashboard]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { void loadMatches(); }, [loadMatches]);

  const summary = dashboard?.summary;
  const coverageMax = Math.max(...(dashboard?.supermarkets.map((item) => value(item.products)) ?? [1]));
  const crawlProgress = dashboard?.run?.tasks_total ? Math.round((dashboard.run.tasks_completed / dashboard.run.tasks_total) * 100) : 100;
  const activeNav = NAV[view];

  function navigate(next: View) {
    const nextWorld = NAV[next].world;
    setWorld(nextWorld);
    setView(next);
    window.localStorage.setItem("mgp-intelligence-world", nextWorld);
    window.location.hash = next;
    setAppliedQuery(""); setQuery(""); setProductPage(1); setMatchPage(1);
  }

  function switchWorld(next: World) {
    navigate(next === "retailer" ? "retailer-overview" : "brand-overview");
  }

  function search(event: FormEvent) {
    event.preventDefault(); setAppliedQuery(query.trim()); setProductPage(1); setMatchPage(1);
  }

  async function startCrawl() {
    setStarting(true);
    try {
      const response = await fetch("/api/scrape", { cache: "no-store" });
      if (!response.ok) throw new Error("No fue posible iniciar la actualización");
      setNotice("Actualización iniciada. Los workers continuarán procesando el catálogo.");
      await loadDashboard();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Error al iniciar"); }
    finally { setStarting(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate(world === "retailer" ? "retailer-overview" : "brand-overview")}><span>M</span><div><strong>MGP Intelligence</strong><small>Commerce Decision Platform</small></div></button>

      <div className={styles.worldSwitcher}>
        <button className={world === "retailer" ? styles.worldActive : ""} onClick={() => switchWorld("retailer")}><span>R</span><div><strong>Retailer</strong><small>Pricing & assortment</small></div></button>
        <button className={world === "brand" ? styles.worldActive : ""} onClick={() => switchWorld("brand")}><span>B</span><div><strong>Marcas</strong><small>Digital shelf & execution</small></div></button>
      </div>

      <nav className={styles.worldNav}>
        {world === "retailer" ? <>
          <button className={view === "retailer-overview" ? "active" : ""} onClick={() => navigate("retailer-overview")}><span>Executive Overview</span><small>Retailer</small></button>
          <div className={styles.navGroup}><div><span>Pricing Intelligence</span><small>3 módulos</small></div>
            <button className={view === "price-image" ? "active" : ""} onClick={() => navigate("price-image")}><span>Price Image Index</span><small>100</small></button>
            <button className={view === "price-matching" ? "active" : ""} onClick={() => navigate("price-matching")}><span>Price Matching</span><small>SKU</small></button>
            <button className={view === "competitive" ? "active" : ""} onClick={() => navigate("competitive")}><span>Competitive Analysis</span><em>AI</em></button>
          </div>
          <div className={styles.navGroup}><div><span>Commercial Intelligence</span><small>4 módulos</small></div>
            <button className={view === "promotions" ? "active" : ""} onClick={() => navigate("promotions")}><span>Promotions</span><small>Promo</small></button>
            <button className={view === "assortment-gaps" ? "active" : ""} onClick={() => navigate("assortment-gaps")}><span>Assortment Gaps</span><small>Gap</small></button>
            <button className={view === "price-movements" ? "active" : ""} onClick={() => navigate("price-movements")}><span>Price Movements</span><small>Daily</small></button>
            <button className={view === "basket-simulator" ? "active" : ""} onClick={() => navigate("basket-simulator")}><span>Basket Simulator</span><small>Basket</small></button>
          </div>
          <button className={view === "products" ? "active" : ""} onClick={() => navigate("products")}><span>Product Explorer</span><small>Catálogo</small></button>
        </> : <>
          <button className={view === "brand-overview" ? "active" : ""} onClick={() => navigate("brand-overview")}><span>Executive Overview</span><small>Marca</small></button>
          <div className={styles.navGroup}><div><span>Brand Intelligence</span><small>4 módulos</small></div>
            <button className={view === "digital-shelf" ? "active" : ""} onClick={() => navigate("digital-shelf")}><span>Digital Shelf</span><small>Shelf</small></button>
            <button className={view === "brand-pricing" ? "active" : ""} onClick={() => navigate("brand-pricing")}><span>Pricing & Promotions</span><small>Price</small></button>
            <button className={view === "availability" ? "active" : ""} onClick={() => navigate("availability")}><span>Availability</span><small>Stock</small></button>
            <button className={view === "benchmark" ? "active" : ""} onClick={() => navigate("benchmark")}><span>Competitor Benchmark</span><small>Brand</small></button>
          </div>
          <div className={styles.navGroup}><div><span>Retail Execution</span><small>2 módulos</small></div>
            <button className={view === "scorecards" ? "active" : ""} onClick={() => navigate("scorecards")}><span>Retailer Scorecards</span><small>Score</small></button>
            <button className={view === "launch-tracker" ? "active" : ""} onClick={() => navigate("launch-tracker")}><span>Launch Tracker</span><small>New</small></button>
          </div>
        </>}
      </nav>

      <div className="side-status"><div><i /><strong>{dashboard?.run?.status === "running" ? "Crawler activo" : "Data pipeline online"}</strong></div><p>{number(summary?.total_products)} SKU monitoreados</p><div className="mini-progress"><span style={{ width: `${crawlProgress}%` }} /></div></div>
    </aside>

    <main>
      {view === "retailer-overview" && <>
        <section className="hero"><div className="hero-copy"><span className="eyebrow">RETAILER INTELLIGENCE · CHILE</span><h1>Gestiona competitividad, precio y surtido desde una sola vista.</h1><p>Prioriza decisiones de pricing, promociones, canastas y brechas de surtido con datos públicos normalizados y análisis asistido por IA.</p><div className="hero-actions"><button className="primary" onClick={() => navigate("price-image")}>Abrir Price Image <Icon name="arrow" /></button><button className="secondary" onClick={() => navigate("competitive")}>Competitive AI</button></div></div><div className="hero-console"><div className="console-top"><span>Market pulse</span><b>LIVE</b></div><div className="console-number">{loadingDashboard ? "—" : number(summary?.total_products)}</div><p>SKU capturados en tres cadenas</p><div className="spark-bars">{dashboard?.supermarkets.map((store) => <div key={store.supermarket}><span style={{ height: `${Math.max(24, value(store.products) / coverageMax * 100)}%` }} /><small>{store.supermarket}</small></div>)}</div></div></section>
        <section className="metrics"><Metric label="Productos monitoreados" metric={number(summary?.total_products)} detail="Catálogo consolidado" /><Metric label="Disponibilidad" metric={summary ? percentage(value(summary.in_stock_products) / Math.max(1, value(summary.total_products)) * 100) : "—"} detail="SKU con stock" /><Metric label="Promociones" metric={number(summary?.offers)} detail="Precio menor al regular" /><Metric label="Ahorro detectado" metric={money(summary?.total_savings)} detail="Brecha promocional acumulada" /></section>
        <section className={styles.solutionGrid}><button onClick={() => navigate("price-image")}><span>01</span><h2>Price Image</h2><p>Mide qué tan barata o cara se percibe cada cadena y categoría.</p><b>Construir índice →</b></button><button onClick={() => navigate("competitive")}><span>02</span><h2>Competitive AI</h2><p>Analiza un SKU y recibe rango, posición, riesgos y acciones.</p><b>Abrir análisis →</b></button><button onClick={() => navigate("assortment-gaps")}><span>03</span><h2>Assortment Gaps</h2><p>Encuentra brechas comparables, no rankings brutos de taxonomía.</p><b>Detectar oportunidades →</b></button><button onClick={() => navigate("basket-simulator")}><span>04</span><h2>Basket Simulator</h2><p>Compara el costo real de una canasta equivalente por cadena.</p><b>Simular canasta →</b></button></section>
        <section className="dual-grid"><div className="panel"><div className="panel-head"><div><span>MARKET COVERAGE</span><h2>Cobertura por cadena</h2></div><button onClick={() => navigate("assortment-gaps")}>Ver brechas</button></div><div className="coverage-list">{dashboard?.supermarkets.map((store) => <div key={store.supermarket}><div><StoreBadge name={store.supermarket} /><strong>{number(store.products)} SKU</strong></div><div className="bar"><span className={storeClass(store.supermarket)} style={{ width: `${value(store.products) / coverageMax * 100}%` }} /></div><small>{number(store.in_stock)} disponibles · precio medio {money(store.average_price)}</small></div>)}</div></div><div className="panel"><div className="panel-head"><div><span>DATA PIPELINE</span><h2>Estado de captura</h2></div><button onClick={startCrawl} disabled={starting}><Icon name="refresh" /> {starting ? "Iniciando" : "Actualizar"}</button></div><div className="pipeline"><strong>{crawlProgress}%</strong><div className="bar"><span style={{ width: `${crawlProgress}%` }} /></div><div><span>{number(dashboard?.run?.tasks_completed)} tareas completadas</span><span>{number(dashboard?.run?.tasks_failed)} errores</span></div></div></div></section>
      </>}

      {view !== "retailer-overview" && <header className="workspace-header"><div><span className="eyebrow">{world === "retailer" ? "RETAILER WORKSPACE" : "BRAND WORKSPACE"}</span><h1>{activeNav.label}</h1><p>{activeNav.description}</p></div><div className="updated"><span>Última actualización</span><strong>{dateTime(summary?.last_updated)}</strong></div></header>}
      {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {BRAND_VIEWS.includes(view as BrandView) && <BrandWorld view={view as BrandView} />}
      {view === "competitive" && <CompetitiveWorkspace />}
      {(["price-image", "assortment-gaps", "price-movements", "basket-simulator"] as RetailerDecisionView[]).includes(view as RetailerDecisionView) && <RetailerDecisionWorkspace view={view as RetailerDecisionView} supermarkets={dashboard?.supermarkets ?? []} categories={dashboard?.categories ?? []} matches={matches.matches} topOffers={dashboard?.topOffers ?? []} />}

      {view === "price-matching" && <section className="workspace"><div className="metrics"><Metric label="Matches exactos" metric={number(matches.total)} detail="Grupos comparables" /><Metric label="Productos visibles" metric={number(matches.matches.reduce((sum, item) => sum + item.listings, 0))} detail="En esta página" /><Metric label="Mayor brecha" metric={money(Math.max(...matches.matches.map((item) => value(item.price_gap)), 0))} detail="Diferencia absoluta" /><Metric label="Matching" metric="Alta confianza" detail="Nombre, marca y formato" /></div><form className="filters" onSubmit={search}><label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o marca" /></label><select value={minSavings} onChange={(event) => { setMinSavings(event.target.value); setMatchPage(1); }}><option value="0">Cualquier brecha</option><option value="5">Ahorro ≥ 5%</option><option value="10">Ahorro ≥ 10%</option><option value="20">Ahorro ≥ 20%</option></select><select value={matchSort} onChange={(event) => { setMatchSort(event.target.value); setMatchPage(1); }}><option value="gap_desc">Mayor ahorro $</option><option value="savings_desc">Mayor ahorro %</option><option value="price_asc">Menor precio</option><option value="updated_desc">Más recientes</option><option value="name_asc">Nombre A–Z</option></select><button className="primary">Buscar</button></form><div className="match-list">{loadingMatches ? <div className="loading-block">Construyendo comparaciones…</div> : matches.matches.map((match) => <MatchingCard key={match.match_key} match={match} />)}</div><div className="pagination"><button disabled={matchPage <= 1} onClick={() => setMatchPage((page) => page - 1)}>Anterior</button><span>Página {matches.page} de {matches.totalPages} · {number(matches.total)} matches</span><button disabled={matchPage >= matches.totalPages} onClick={() => setMatchPage((page) => page + 1)}>Siguiente</button></div></section>}

      {(view === "products" || view === "promotions") && <section className="workspace"><form className="filters" onSubmit={search}><label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, marca o SKU" /></label><select value={supermarket} onChange={(event) => { setSupermarket(event.target.value); setProductPage(1); }}><option value="">Todas las cadenas</option><option>Lider</option><option>Jumbo</option><option>Santa Isabel</option></select><select value={stock} onChange={(event) => { setStock(event.target.value); setProductPage(1); }}><option value="all">Todo stock</option><option value="in">Disponible</option><option value="out">Sin stock</option></select><select value={sort} onChange={(event) => { setSort(event.target.value); setProductPage(1); }}><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="discount_desc">Mayor descuento</option><option value="newest">Más recientes</option><option value="name_asc">Nombre A–Z</option></select><button className="primary">Buscar</button></form><div className="panel"><div className="panel-head"><div><span>{view === "promotions" ? "PROMOTION INTELLIGENCE" : "CATALOG EXPLORER"}</span><h2>{number(products.total)} resultados</h2></div></div><ProductTable products={products.products} loading={loadingProducts} /><div className="pagination"><button disabled={productPage <= 1} onClick={() => setProductPage((page) => page - 1)}>Anterior</button><span>Página {products.page} de {products.totalPages}</span><button disabled={productPage >= products.totalPages} onClick={() => setProductPage((page) => page + 1)}>Siguiente</button></div></div></section>}
    </main>
  </div>;
}
