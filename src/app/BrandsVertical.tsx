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

type LiveItem = {
  key: string;
  name: string;
  category: string;
  currentPrice: number;
  regularPrice: number | null;
  discountPct: number | null;
  units: number | null;
  unitPrice: number | null;
  benchmark: string | null;
  benchmarkLabel: string | null;
};

type LiveSource = {
  role: "brand" | "competitor";
  brand: string;
  channel: string;
  location: string;
  url: string;
  status: "ok" | "degraded";
  observedAt: string;
  items: LiveItem[];
  metrics: { items: number; promoItems: number; lowestPrice: number | null; maxDiscountPct: number | null };
  error: string | null;
};

type LiveBenchmark = {
  key: string;
  label: string;
  subject: { brand: string; price: number; unitPrice: number | null };
  competitor: { brand: string; price: number; unitPrice: number | null };
  gapPct: number | null;
  leader: string | null;
  note: string;
};

type LivePulse = {
  status: "live" | "partial" | "unavailable";
  category: string;
  subjectBrand: string;
  competitorBrand: string;
  channel: string;
  market: string;
  observedAt: string;
  sources: LiveSource[];
  benchmarks: LiveBenchmark[];
};

type Payload = {
  brand: { id: string; slug: string; name: string; countryCode: string; officialUrl: string | null };
  summary: { products: number; sources: number; listings: number; sellers: number; inStockPct: number | null; promoPct: number | null; lastObservedAt: string | null };
  sources: Source[];
  products: Product[];
  listings: Listing[];
  lastRun: null | { status: string; sourcesAttempted: number; sourcesSucceeded: number; listingsFound: number; productsFound: number; startedAt: string | null; finishedAt: string | null; notes: string | null };
  live: LivePulse | null;
};

type Tab = "overview" | "competition" | "products" | "retailers" | "listings";

const BRAND_OPTIONS = [
  { slug: "victorinox", name: "Victorinox", detail: "Retail intelligence" },
  { slug: "krispy-kreme", name: "Krispy Kreme", detail: "vs Dunkin · Live" },
  { slug: "little-caesars", name: "Little Caesars", detail: "vs Papa Johns · Live" },
];

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("es-CL");

function moneyOrDash(value: number | null) { return value && value > 0 ? money.format(value) : "—"; }
function dateOrDash(value: string | null) { return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function liveLabel(status: LivePulse["status"]) { return status === "live" ? "EN VIVO" : status === "partial" ? "PARCIAL" : "SIN SEÑAL"; }

export default function BrandsVertical() {
  const [selectedBrand, setSelectedBrand] = useState("victorinox");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSource("");
    setQuery("");
    fetch(`/api/brands?brand=${encodeURIComponent(selectedBrand)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "brands_failed"); return await response.json() as Payload; })
      .then(value => { if (active) setPayload(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar Brands."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedBrand]);

  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payload?.listings || []).filter(item => (!source || item.domain === source) && (!q || `${item.title} ${item.seller || ""} ${item.category || ""}`.toLowerCase().includes(q)));
  }, [payload, query, source]);
  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (payload?.products || []).filter(item => !q || `${item.name} ${item.sku || ""} ${item.ean || ""} ${item.category || ""}`.toLowerCase().includes(q));
  }, [payload, query]);

  if (loading) return <section className={styles.shell}><div className={styles.state}>Actualizando {BRAND_OPTIONS.find(item => item.slug === selectedBrand)?.name || "Brands"}…</div></section>;
  if (error || !payload) return <section className={styles.shell}><div className={styles.error}>{error || "Brands no está disponible."}</div></section>;

  const run = payload.lastRun;
  const live = payload.live;
  const brandSource = live?.sources.find(item => item.role === "brand");
  const competitorSource = live?.sources.find(item => item.role === "competitor");

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>BRANDS · RETAIL & COMPETITIVE INTELLIGENCE</span>
        <h1>{payload.brand.name}</h1>
        <p>{live ? `${live.subjectBrand} vs ${live.competitorBrand} · precios y promociones observados en ${live.channel}, ${live.market}.` : "Descubrimiento de canales, catálogo, precios y presencia digital en retailers y marketplaces."}</p>
      </div>
      <label className={styles.brandPicker}>
        <span>Marca</span>
        <select value={selectedBrand} onChange={event => { setSelectedBrand(event.target.value); setTab("overview"); }}>
          {BRAND_OPTIONS.map(item => <option key={item.slug} value={item.slug}>{item.name} · {item.detail}</option>)}
        </select>
        <small>Chile · selecciona una vertical</small>
      </label>
    </div>

    <nav className={styles.tabs} aria-label="Secciones Brands">
      {([["overview","Overview"], ...(live ? [["competition","Competencia"]] : []), ["products","Productos"],["retailers","Retailers"],["listings","Listings"]] as [Tab,string][]).map(([key,label]) => <button key={key} className={tab===key?styles.activeTab:""} onClick={()=>setTab(key)}>{label}</button>)}
    </nav>

    {tab === "overview" && <>
      {live && <article className={styles.competitionBanner}>
        <div className={styles.competitionHeadline}>
          <div>
            <span className={live.status === "live" ? styles.live : styles.partial}>{liveLabel(live.status)}</span>
            <h2>{live.subjectBrand} <i>vs</i> {live.competitorBrand}</h2>
            <p>{live.channel} · {brandSource?.location || live.market} · actualización {dateOrDash(live.observedAt)}</p>
          </div>
          <button onClick={() => setTab("competition")}>Abrir comparación →</button>
        </div>
        <div className={styles.pulseGrid}>
          {[brandSource, competitorSource].filter((item): item is LiveSource => Boolean(item)).map(item => <div key={item.brand} className={styles.pulseCard}>
            <span>{item.role === "brand" ? "MARCA" : "COMPETIDOR"}</span>
            <strong>{item.brand}</strong>
            <div><b>{item.metrics.items}</b><small> precios detectados</small></div>
            <div><b>{item.metrics.promoItems}</b><small> en promo</small></div>
            <div><b>{moneyOrDash(item.metrics.lowestPrice)}</b><small> entrada</small></div>
          </div>)}
        </div>
      </article>}

      <div className={styles.kpis}>
        <article><span>Productos detectados</span><strong>{number.format(payload.summary.products)}</strong></article>
        <article><span>Fuentes monitoreadas</span><strong>{number.format(payload.summary.sources)}</strong></article>
        <article><span>Listings históricos</span><strong>{number.format(payload.summary.listings)}</strong></article>
        <article><span>Sellers detectados</span><strong>{number.format(payload.summary.sellers)}</strong></article>
        <article><span>Disponibilidad</span><strong>{payload.summary.inStockPct == null ? "—" : `${payload.summary.inStockPct}%`}</strong></article>
        <article><span>En promoción</span><strong>{payload.summary.promoPct == null ? "—" : `${payload.summary.promoPct}%`}</strong></article>
      </div>
      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Fuentes monitoreadas</h2><p>Canales configurados y estado de captura histórica.</p></div><span className={styles.live}>LIVE</span></div>
          <div className={styles.sourceList}>{payload.sources.map(s => <div className={styles.sourceRow} key={s.id}><div><strong>{s.retailer_name}</strong><span>{s.domain} · {s.source_type}</span></div><div><b>{s.listings}</b><small> listings</small></div><span className={s.last_status?.startsWith("ok")?styles.ok:styles.muted}>{s.last_status || "configurada"}</span></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Última corrida histórica</h2><p>Estado operativo del motor de discovery.</p></div></div>
          <div className={styles.runBox}>
            <strong>{run?.status || "Sin corrida"}</strong>
            <p>{run ? `${run.sourcesSucceeded}/${run.sourcesAttempted} fuentes respondieron · ${run.listingsFound} listings encontrados` : live ? "La lectura en vivo funciona independiente del histórico; las capturas persistidas comenzarán a construir tendencia." : "El worker aún no registra una corrida."}</p>
            <dl><div><dt>Inicio</dt><dd>{dateOrDash(run?.startedAt || null)}</dd></div><div><dt>Fin</dt><dd>{dateOrDash(run?.finishedAt || null)}</dd></div><div><dt>Último histórico</dt><dd>{dateOrDash(payload.summary.lastObservedAt)}</dd></div></dl>
          </div>
        </article>
      </div>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><h2>Lectura inicial</h2><p>El análisis usa datos observados y no completa precios ausentes.</p></div></div>
        <div className={styles.insights}>
          <p><strong>Cobertura:</strong> {live ? `${live.sources.filter(item => item.status === "ok").length}/${live.sources.length} fuentes competitivas están respondiendo en esta lectura.` : payload.summary.listings ? `ya existen ${payload.summary.listings} listings observados en ${payload.summary.sources} fuentes.` : `hay ${payload.summary.sources} fuentes priorizadas, pero todavía no hay listings válidos capturados.`}</p>
          <p><strong>Canal:</strong> {live ? `la comparación visible usa ${live.channel} para ambos players, evitando mezclar precio de tienda con precio de delivery.` : "el motor separa tienda oficial, retailer y marketplace para evitar mezclar precios propios con sellers terceros."}</p>
          <p><strong>Siguiente señal:</strong> el histórico permitirá medir dispersión, profundidad promocional, frecuencia de cambios y arquitectura de packs por competidor.</p>
        </div>
      </article>
    </>}

    {tab === "competition" && live && <>
      <article className={styles.liveHeader}>
        <div>
          <span className={live.status === "live" ? styles.live : styles.partial}>{liveLabel(live.status)}</span>
          <h2>Competitive pulse</h2>
          <p>{live.category} · {live.channel} · {live.market}. Misma capa de canal para una comparación consistente.</p>
        </div>
        <small>Actualizado {dateOrDash(live.observedAt)}</small>
      </article>

      {live.benchmarks.length > 0 && <div className={styles.benchmarkGrid}>
        {live.benchmarks.map(benchmark => <article key={benchmark.key} className={styles.benchmarkCard}>
          <span>{benchmark.label}</span>
          <div className={styles.benchmarkPrices}>
            <div><small>{benchmark.subject.brand}</small><strong>{moneyOrDash(benchmark.subject.price)}</strong>{benchmark.subject.unitPrice ? <em>{moneyOrDash(benchmark.subject.unitPrice)} / unidad</em> : null}</div>
            <div><small>{benchmark.competitor.brand}</small><strong>{moneyOrDash(benchmark.competitor.price)}</strong>{benchmark.competitor.unitPrice ? <em>{moneyOrDash(benchmark.competitor.unitPrice)} / unidad</em> : null}</div>
          </div>
          <p><b>{benchmark.leader || "—"}</b>{benchmark.gapPct == null ? "" : ` tiene el mejor precio efectivo · brecha ${Math.abs(benchmark.gapPct)}%`}</p>
          <small className={styles.note}>{benchmark.note}</small>
        </article>)}
      </div>}

      <div className={styles.liveSourceGrid}>
        {live.sources.map(item => <article key={`${item.role}-${item.brand}`} className={styles.panel}>
          <div className={styles.sourceHero}>
            <div><span>{item.role === "brand" ? "MARCA ANALIZADA" : "COMPETIDOR DIRECTO"}</span><h2>{item.brand}</h2><p>{item.channel} · {item.location}</p></div>
            <a href={item.url} target="_blank" rel="noreferrer">Ver fuente ↗</a>
          </div>
          <div className={styles.microKpis}>
            <div><span>Detectados</span><strong>{item.metrics.items}</strong></div>
            <div><span>En promo</span><strong>{item.metrics.promoItems}</strong></div>
            <div><span>Precio entrada</span><strong>{moneyOrDash(item.metrics.lowestPrice)}</strong></div>
            <div><span>Desc. máx.</span><strong>{item.metrics.maxDiscountPct ? `${item.metrics.maxDiscountPct}%` : "—"}</strong></div>
          </div>
          {item.status === "degraded" && <div className={styles.sourceWarning}>La fuente no expuso precios en esta lectura. {item.error || ""}</div>}
          <div className={styles.liveItems}>
            {item.items.map(product => <div className={styles.liveItem} key={product.key}>
              <div><span>{product.category}</span><strong>{product.name}</strong>{product.units && product.units > 1 && product.unitPrice ? <small>{moneyOrDash(product.unitPrice)} por unidad</small> : null}</div>
              <div className={styles.priceCell}><strong>{moneyOrDash(product.currentPrice)}</strong>{product.regularPrice ? <small>Ref. {moneyOrDash(product.regularPrice)}</small> : null}{product.discountPct ? <b>-{product.discountPct}%</b> : null}</div>
            </div>)}
            {!item.items.length && <div className={styles.emptyLive}>Sin precios parseables en esta captura.</div>}
          </div>
        </article>)}
      </div>
    </>}

    {(tab === "products" || tab === "listings") && <div className={styles.filters}>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, seller o categoría…" />
      {tab === "listings" && <select value={source} onChange={e=>setSource(e.target.value)}><option value="">Todos los retailers</option>{payload.sources.map(s=><option key={s.id} value={s.domain}>{s.retailer_name}</option>)}</select>}
    </div>}

    {tab === "products" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Catálogo maestro</h2><p>Productos {payload.brand.name} normalizados desde las fuentes observadas.</p></div><span>{visibleProducts.length} productos</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>SKU / EAN</th><th>Categoría</th><th>Última detección</th></tr></thead><tbody>{visibleProducts.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.sku || p.ean || "—"}</td><td>{p.category || "—"}</td><td>{dateOrDash(p.lastSeenAt)}</td></tr>)}{!visibleProducts.length&&<tr><td colSpan={4} className={styles.empty}>Aún no hay productos capturados en el histórico.</td></tr>}</tbody></table></div></article>}

    {tab === "retailers" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Mapa de fuentes</h2><p>Canales donde la marca y su set competitivo están configurados.</p></div></div><div className={styles.cards}>{payload.sources.map(s=><div className={styles.retailCard} key={s.id}><span>{s.source_type}</span><h3>{s.retailer_name}</h3><p>{s.domain}</p><dl><div><dt>Listings</dt><dd>{s.listings}</dd></div><div><dt>Precio mín.</dt><dd>{moneyOrDash(s.min_price)}</dd></div><div><dt>Precio máx.</dt><dd>{moneyOrDash(s.max_price)}</dd></div></dl><small>Último crawl: {dateOrDash(s.last_crawled_at)}</small>{s.last_error&&<em>{s.last_error}</em>}</div>)}</div></article>}

    {tab === "listings" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Listings históricos</h2><p>Precio, seller, stock y evidencia persistida por fuente.</p></div><span>{visibleListings.length} registros</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Retailer / Seller</th><th>Precio</th><th>Stock</th><th>Observado</th></tr></thead><tbody>{visibleListings.map(l=><tr key={l.id}><td><a href={l.url} target="_blank" rel="noreferrer"><strong>{l.title}</strong></a></td><td>{l.source}<small className={styles.block}>{l.seller || l.domain}</small></td><td><strong>{moneyOrDash(l.currentPrice)}</strong>{l.regularPrice&&l.currentPrice&&l.regularPrice>l.currentPrice?<small className={styles.block}>Ref. {moneyOrDash(l.regularPrice)}</small>:null}</td><td>{l.inStock===null?"—":l.inStock?"Disponible":"Sin stock"}</td><td>{dateOrDash(l.observedAt)}</td></tr>)}{!visibleListings.length&&<tr><td colSpan={5} className={styles.empty}>Aún no hay listings históricos para esta vertical.</td></tr>}</tbody></table></div></article>}
  </section>;
}
