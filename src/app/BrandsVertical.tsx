"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./BrandsVertical.module.css";

type Source = {
  id: string;
  retailer_name: string;
  domain: string;
  source_type: string;
  priority: number;
  last_crawled_at: string | null;
  last_status: string | null;
  last_error: string | null;
  listings: number;
  in_stock: number;
  min_price: number | null;
  max_price: number | null;
};

type Product = {
  id: string;
  sku: string | null;
  ean: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  url: string | null;
  imageUrl: string | null;
  attributes: Record<string, unknown>;
  lastSeenAt: string;
};

type Listing = {
  id: string;
  source: string;
  domain: string;
  title: string;
  seller: string | null;
  category: string | null;
  url: string;
  imageUrl: string | null;
  regularPrice: number | null;
  currentPrice: number | null;
  currency: string;
  inStock: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  observedAt: string;
};

type Payload = {
  brand: { id: string; slug: string; name: string; countryCode: string; officialUrl: string };
  summary: { products: number; sources: number; listings: number; sellers: number; inStockPct: number | null; promoPct: number | null; lastObservedAt: string | null };
  sources: Source[];
  products: Product[];
  listings: Listing[];
  lastRun: null | { status: string; sourcesAttempted: number; sourcesSucceeded: number; listingsFound: number; productsFound: number; startedAt: string | null; finishedAt: string | null; notes: string | null };
};

type Tab = "overview" | "products" | "retailers" | "listings";
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("es-CL");

function moneyOrDash(value: number | null) { return value && value > 0 ? money.format(value) : "—"; }
function dateOrDash(value: string | null) { return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }

export default function BrandsVertical() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/brands?brand=victorinox", { credentials: "same-origin" })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "brands_failed"); return await response.json() as Payload; })
      .then(value => { if (active) setPayload(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar Brands."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payload?.listings || []).filter(item => (!source || item.domain === source) && (!q || `${item.title} ${item.seller || ""} ${item.category || ""}`.toLowerCase().includes(q)));
  }, [payload, query, source]);
  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payload?.products || []).filter(item => !q || `${item.name} ${item.sku || ""} ${item.ean || ""} ${item.category || ""}`.toLowerCase().includes(q));
  }, [payload, query]);

  if (loading) return <section className={styles.shell}><div className={styles.state}>Cargando Brands…</div></section>;
  if (error || !payload) return <section className={styles.shell}><div className={styles.error}>{error || "Brands no está disponible."}</div></section>;

  const run = payload.lastRun;
  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>BRANDS · RETAIL INTELLIGENCE</span>
        <h1>{payload.brand.name}</h1>
        <p>Descubrimiento de canales, catálogo, precios y presencia digital en retailers y marketplaces.</p>
      </div>
      <div className={styles.brandPicker}><span>Marca</span><strong>{payload.brand.name}</strong><small>Chile · primera marca activa</small></div>
    </div>

    <nav className={styles.tabs} aria-label="Secciones Brands">
      {([["overview","Overview"],["products","Productos"],["retailers","Retailers"],["listings","Listings"]] as [Tab,string][]).map(([key,label]) => <button key={key} className={tab===key?styles.activeTab:""} onClick={()=>setTab(key)}>{label}</button>)}
    </nav>

    {tab === "overview" && <>
      <div className={styles.kpis}>
        <article><span>Productos detectados</span><strong>{number.format(payload.summary.products)}</strong></article>
        <article><span>Fuentes monitoreadas</span><strong>{number.format(payload.summary.sources)}</strong></article>
        <article><span>Listings vigentes</span><strong>{number.format(payload.summary.listings)}</strong></article>
        <article><span>Sellers detectados</span><strong>{number.format(payload.summary.sellers)}</strong></article>
        <article><span>Disponibilidad</span><strong>{payload.summary.inStockPct == null ? "—" : `${payload.summary.inStockPct}%`}</strong></article>
        <article><span>En promoción</span><strong>{payload.summary.promoPct == null ? "—" : `${payload.summary.promoPct}%`}</strong></article>
      </div>
      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Retailer discovery</h2><p>Fuentes configuradas y estado de captura.</p></div><span className={styles.live}>LIVE</span></div>
          <div className={styles.sourceList}>{payload.sources.map(s => <div className={styles.sourceRow} key={s.id}><div><strong>{s.retailer_name}</strong><span>{s.domain} · {s.source_type}</span></div><div><b>{s.listings}</b><small> listings</small></div><span className={s.last_status?.startsWith("ok")?styles.ok:styles.muted}>{s.last_status || "pendiente"}</span></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Última corrida</h2><p>Estado operativo del motor de discovery.</p></div></div>
          <div className={styles.runBox}>
            <strong>{run?.status || "Sin corrida"}</strong>
            <p>{run ? `${run.sourcesSucceeded}/${run.sourcesAttempted} fuentes respondieron · ${run.listingsFound} listings encontrados` : "El worker aún no registra una corrida."}</p>
            <dl><div><dt>Inicio</dt><dd>{dateOrDash(run?.startedAt || null)}</dd></div><div><dt>Fin</dt><dd>{dateOrDash(run?.finishedAt || null)}</dd></div><div><dt>Último dato</dt><dd>{dateOrDash(payload.summary.lastObservedAt)}</dd></div></dl>
          </div>
        </article>
      </div>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><h2>Lectura inicial</h2><p>El análisis se actualiza con cada captura y no rellena datos ausentes.</p></div></div>
        <div className={styles.insights}>
          <p><strong>Cobertura:</strong> {payload.summary.listings ? `ya existen ${payload.summary.listings} listings observados en ${payload.summary.sources} fuentes.` : `hay ${payload.summary.sources} fuentes priorizadas, pero todavía no hay listings válidos capturados.`}</p>
          <p><strong>Canal:</strong> el motor separa tienda oficial, retailer y marketplace para evitar mezclar precios propios con sellers terceros.</p>
          <p><strong>Siguiente señal:</strong> cuando exista historial, Brands podrá medir dispersión, profundidad promocional, disponibilidad y diferencias por seller/SKU.</p>
        </div>
      </article>
    </>}

    {(tab === "products" || tab === "listings") && <div className={styles.filters}>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, seller o categoría…" />
      {tab === "listings" && <select value={source} onChange={e=>setSource(e.target.value)}><option value="">Todos los retailers</option>{payload.sources.map(s=><option key={s.id} value={s.domain}>{s.retailer_name}</option>)}</select>}
    </div>}

    {tab === "products" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Catálogo maestro</h2><p>Productos Victorinox normalizados desde las fuentes observadas.</p></div><span>{visibleProducts.length} productos</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>SKU / EAN</th><th>Categoría</th><th>Última detección</th></tr></thead><tbody>{visibleProducts.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.sku || p.ean || "—"}</td><td>{p.category || "—"}</td><td>{dateOrDash(p.lastSeenAt)}</td></tr>)}{!visibleProducts.length&&<tr><td colSpan={4} className={styles.empty}>Aún no hay productos capturados.</td></tr>}</tbody></table></div></article>}

    {tab === "retailers" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Mapa de retailers</h2><p>Fuentes donde la marca fue configurada o descubierta.</p></div></div><div className={styles.cards}>{payload.sources.map(s=><div className={styles.retailCard} key={s.id}><span>{s.source_type}</span><h3>{s.retailer_name}</h3><p>{s.domain}</p><dl><div><dt>Listings</dt><dd>{s.listings}</dd></div><div><dt>Precio mín.</dt><dd>{moneyOrDash(s.min_price)}</dd></div><div><dt>Precio máx.</dt><dd>{moneyOrDash(s.max_price)}</dd></div></dl><small>Último crawl: {dateOrDash(s.last_crawled_at)}</small>{s.last_error&&<em>{s.last_error}</em>}</div>)}</div></article>}

    {tab === "listings" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Listings observados</h2><p>Precio, seller, stock y evidencia por fuente.</p></div><span>{visibleListings.length} registros</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Retailer / Seller</th><th>Precio</th><th>Stock</th><th>Observado</th></tr></thead><tbody>{visibleListings.map(l=><tr key={l.id}><td><a href={l.url} target="_blank" rel="noreferrer"><strong>{l.title}</strong></a></td><td>{l.source}<small className={styles.block}>{l.seller || l.domain}</small></td><td><strong>{moneyOrDash(l.currentPrice)}</strong>{l.regularPrice&&l.currentPrice&&l.regularPrice>l.currentPrice?<small className={styles.block}>Ref. {moneyOrDash(l.regularPrice)}</small>:null}</td><td>{l.inStock===null?"—":l.inStock?"Disponible":"Sin stock"}</td><td>{dateOrDash(l.observedAt)}</td></tr>)}{!visibleListings.length&&<tr><td colSpan={5} className={styles.empty}>Aún no hay listings válidos capturados.</td></tr>}</tbody></table></div></article>}
  </section>;
}
