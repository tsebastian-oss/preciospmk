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
  promotion?: boolean;
  promoMechanic?: string | null;
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
  mode?: "persisted" | "live";
  freshness?: "fresh" | "recent" | "stale" | "unavailable";
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
  { slug: "krispy-kreme", name: "Krispy Kreme", detail: "vs Dunkin · QSR" },
  { slug: "little-caesars", name: "Little Caesars", detail: "vs Papa Johns · QSR" },
  { slug: "victorinox", name: "Victorinox", detail: "Retail intelligence" },
];

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("es-CL");

function moneyOrDash(value: number | null) { return value && value > 0 ? money.format(value) : "—"; }
function dateOrDash(value: string | null) { return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function percent(value: number | null) { return value == null ? "—" : `${Math.abs(value).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`; }
function pulseLabel(live: LivePulse) {
  if (live.mode === "persisted") {
    if (live.freshness === "fresh") return "CAPTURA VERIFICADA";
    if (live.freshness === "recent") return "CAPTURA RECIENTE";
    if (live.freshness === "stale") return "ÚLTIMA CAPTURA";
  }
  return live.status === "live" ? "ACTUALIZADO" : live.status === "partial" ? "DATOS PARCIALES" : "SIN SEÑAL";
}
function benchmarkSignal(item: LiveBenchmark) {
  if (item.gapPct == null) return `${item.label}: sin brecha comparable.`;
  if (item.gapPct > 0) return `${item.subject.brand} está ${percent(item.gapPct)} por sobre ${item.competitor.brand} en precio efectivo por unidad.`;
  if (item.gapPct < 0) return `${item.subject.brand} tiene una ventaja de ${percent(item.gapPct)} en precio efectivo por unidad frente a ${item.competitor.brand}.`;
  return `${item.label}: paridad de precio efectivo.`;
}

export default function BrandsVertical() {
  const [selectedBrand, setSelectedBrand] = useState("krispy-kreme");
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

  if (loading) return <section className={styles.shell}><div className={styles.state}>Actualizando inteligencia competitiva…</div></section>;
  if (error || !payload) return <section className={styles.shell}><div className={styles.error}>{error || "Brands no está disponible."}</div></section>;

  const run = payload.lastRun;
  const live = payload.live;
  const qsr = payload.brand.slug === "krispy-kreme" || payload.brand.slug === "little-caesars";
  const brandSource = live?.sources.find(item => item.role === "brand");
  const competitorSource = live?.sources.find(item => item.role === "competitor");
  const monitoredPrices = live?.sources.reduce((sum, item) => sum + item.metrics.items, 0) || payload.summary.listings;
  const pack6 = live?.benchmarks.find(item => item.key === "pack-6");
  const pack12 = live?.benchmarks.find(item => item.key === "pack-12");
  const pack24 = live?.benchmarks.find(item => item.key === "pack-24");

  return <section className={styles.shell}>
    <div className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>{qsr ? "FOOD SERVICE · COMPETITIVE PRICING INTELLIGENCE" : "BRANDS · RETAIL & COMPETITIVE INTELLIGENCE"}</span>
        <h1>{qsr ? `${payload.brand.name} Market Intelligence` : payload.brand.name}</h1>
        <p>{live ? `Monitoreo de precios, promociones y arquitectura de packs de ${live.subjectBrand} vs ${live.competitorBrand} en ${live.market}.` : "Descubrimiento de canales, catálogo, precios y presencia digital en retailers y marketplaces."}</p>
      </div>
      <label className={styles.brandPicker}>
        <span>Vertical analizada</span>
        <select value={selectedBrand} onChange={event => { setSelectedBrand(event.target.value); setTab("overview"); }}>
          {BRAND_OPTIONS.map(item => <option key={item.slug} value={item.slug}>{item.name} · {item.detail}</option>)}
        </select>
        <small>Chile · inteligencia competitiva</small>
      </label>
    </div>

    <nav className={styles.tabs} aria-label="Secciones Brands">
      {([["overview",qsr ? "Resumen ejecutivo" : "Overview"], ...(live ? [["competition","Competencia"]] : []), ["products","Productos"],["retailers","Fuentes"],["listings","Evidencia"]] as [Tab,string][]).map(([key,label]) => <button key={key} className={tab===key?styles.activeTab:""} onClick={()=>setTab(key)}>{label}</button>)}
    </nav>

    {tab === "overview" && <>
      {live && <article className={styles.competitionBanner}>
        <div className={styles.competitionHeadline}>
          <div>
            <span className={live.status === "unavailable" ? styles.partial : styles.live}>{pulseLabel(live)}</span>
            <h2>{live.subjectBrand} <i>vs</i> {live.competitorBrand}</h2>
            <p>{live.channel} · {live.market} · última observación {dateOrDash(live.observedAt)}</p>
          </div>
          <button onClick={() => setTab("competition")}>Ver detalle competitivo →</button>
        </div>
        <div className={styles.pulseGrid}>
          {[brandSource, competitorSource].filter((item): item is LiveSource => Boolean(item)).map(item => <div key={item.brand} className={styles.pulseCard}>
            <span>{item.role === "brand" ? "MARCA ANALIZADA" : "COMPETIDOR DIRECTO"}</span>
            <strong>{item.brand}</strong>
            <div><b>{item.metrics.items}</b><small> precios monitoreados</small></div>
            <div><b>{item.metrics.promoItems}</b><small> mecánicas promo</small></div>
            <div><b>{moneyOrDash(item.metrics.lowestPrice)}</b><small> precio de entrada</small></div>
          </div>)}
        </div>
      </article>}

      {live?.benchmarks.length ? <div className={styles.benchmarkGrid}>
        {live.benchmarks.map(benchmark => <article key={benchmark.key} className={styles.benchmarkCard}>
          <span>{benchmark.label} · PRECIO EFECTIVO</span>
          <div className={styles.benchmarkPrices}>
            <div><small>{benchmark.subject.brand}</small><strong>{moneyOrDash(benchmark.subject.price)}</strong>{benchmark.subject.unitPrice ? <em>{moneyOrDash(benchmark.subject.unitPrice)} / unidad</em> : null}</div>
            <div><small>{benchmark.competitor.brand}</small><strong>{moneyOrDash(benchmark.competitor.price)}</strong>{benchmark.competitor.unitPrice ? <em>{moneyOrDash(benchmark.competitor.unitPrice)} / unidad</em> : null}</div>
          </div>
          <p><b>{benchmark.leader || "—"}</b> lidera · brecha {percent(benchmark.gapPct)}</p>
          <small className={styles.note}>{benchmarkSignal(benchmark)}</small>
        </article>)}
      </div> : null}

      {qsr && live ? <div className={styles.kpis}>
        <article><span>Precios monitoreados</span><strong>{number.format(monitoredPrices)}</strong></article>
        <article><span>Benchmarks comparables</span><strong>{live.benchmarks.length}</strong></article>
        <article><span>Promos competidor</span><strong>{competitorSource?.metrics.promoItems ?? 0}</strong></article>
        <article><span>Brecha pack 6</span><strong>{pack6 ? percent(pack6.gapPct) : "—"}</strong></article>
        <article><span>Ventaja docena</span><strong>{pack12 && (pack12.gapPct ?? 0) < 0 ? percent(pack12.gapPct) : "—"}</strong></article>
        <article><span>Fuentes activas</span><strong>{payload.summary.sources}</strong></article>
      </div> : <div className={styles.kpis}>
        <article><span>Productos detectados</span><strong>{number.format(payload.summary.products)}</strong></article>
        <article><span>Fuentes monitoreadas</span><strong>{number.format(payload.summary.sources)}</strong></article>
        <article><span>Listings históricos</span><strong>{number.format(payload.summary.listings)}</strong></article>
        <article><span>Sellers detectados</span><strong>{number.format(payload.summary.sellers)}</strong></article>
        <article><span>Disponibilidad</span><strong>{payload.summary.inStockPct == null ? "—" : `${payload.summary.inStockPct}%`}</strong></article>
        <article><span>En promoción</span><strong>{payload.summary.promoPct == null ? "—" : `${payload.summary.promoPct}%`}</strong></article>
      </div>}

      {qsr && live && <article className={styles.panel}>
        <div className={styles.panelTitle}><div><h2>Lectura ejecutiva</h2><p>Señales que un equipo de Marketing, Pricing o Comercial puede convertir en acción.</p></div><span>MARKET PULSE</span></div>
        <div className={styles.insights}>
          <p><strong>Pack 6:</strong> {pack6 ? benchmarkSignal(pack6) : "Aún no existe un benchmark homologable."} {pack6?.gapPct && pack6.gapPct > 0 ? "Es la principal zona de presión promocional detectada." : ""}</p>
          <p><strong>Docena:</strong> {pack12 ? benchmarkSignal(pack12) : "Aún no existe un benchmark homologable."} {pack12?.gapPct && pack12.gapPct < 0 ? "La arquitectura de precio de Krispy Kreme mantiene una ventaja competitiva." : ""}</p>
          <p><strong>24 unidades:</strong> {pack24 ? benchmarkSignal(pack24) : "Aún no existe un benchmark homologable."} La evolución histórica permitirá detectar cuándo cambia esta relación.</p>
        </div>
      </article>}

      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Fuentes monitoreadas</h2><p>Canales activos que alimentan la evidencia y el benchmark.</p></div><span className={styles.live}>OPERATIVO</span></div>
          <div className={styles.sourceList}>{payload.sources.map(s => <div className={styles.sourceRow} key={s.id}><div><strong>{s.retailer_name}</strong><span>{s.domain} · {s.source_type}</span></div><div><b>{s.listings}</b><small> observaciones</small></div><span className={s.last_status?.startsWith("ok")?styles.ok:styles.muted}>{s.last_status?.startsWith("ok") ? "OK" : s.last_status || "configurada"}</span></div>)}</div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Calidad de la última captura</h2><p>Trazabilidad del dato mostrado al cliente.</p></div></div>
          <div className={styles.runBox}>
            <strong>{run?.status || (live ? "verificada" : "sin corrida")}</strong>
            <p>{run ? `${run.sourcesSucceeded}/${run.sourcesAttempted} fuentes respondieron · ${run.listingsFound} precios persistidos.` : "La plataforma conserva la última observación válida para evitar pantallas vacías por una caída puntual de una fuente."}</p>
            <dl><div><dt>Última observación</dt><dd>{dateOrDash(live?.observedAt || payload.summary.lastObservedAt)}</dd></div><div><dt>Estado</dt><dd>{live ? pulseLabel(live) : "Histórico"}</dd></div><div><dt>Mercado</dt><dd>{live?.market || payload.brand.countryCode}</dd></div></dl>
          </div>
        </article>
      </div>
    </>}

    {tab === "competition" && live && <>
      <article className={styles.liveHeader}>
        <div>
          <span className={live.status === "unavailable" ? styles.partial : styles.live}>{pulseLabel(live)}</span>
          <h2>Competitive Market Pulse</h2>
          <p>{live.category} · {live.channel} · {live.market}. Para los benchmarks homologables se prioriza la misma capa de canal.</p>
        </div>
        <small>Última observación {dateOrDash(live.observedAt)}</small>
      </article>

      {live.benchmarks.length > 0 && <div className={styles.benchmarkGrid}>
        {live.benchmarks.map(benchmark => <article key={benchmark.key} className={styles.benchmarkCard}>
          <span>{benchmark.label}</span>
          <div className={styles.benchmarkPrices}>
            <div><small>{benchmark.subject.brand}</small><strong>{moneyOrDash(benchmark.subject.price)}</strong>{benchmark.subject.unitPrice ? <em>{moneyOrDash(benchmark.subject.unitPrice)} / unidad</em> : null}</div>
            <div><small>{benchmark.competitor.brand}</small><strong>{moneyOrDash(benchmark.competitor.price)}</strong>{benchmark.competitor.unitPrice ? <em>{moneyOrDash(benchmark.competitor.unitPrice)} / unidad</em> : null}</div>
          </div>
          <p><b>{benchmark.leader || "—"}</b> tiene el mejor precio efectivo · brecha {percent(benchmark.gapPct)}</p>
          <small className={styles.note}>{benchmark.note}</small>
        </article>)}
      </div>}

      <div className={styles.liveSourceGrid}>
        {live.sources.map(item => <article key={`${item.role}-${item.brand}`} className={styles.panel}>
          <div className={styles.sourceHero}>
            <div><span>{item.role === "brand" ? "MARCA ANALIZADA" : "COMPETIDOR DIRECTO"}</span><h2>{item.brand}</h2><p>{item.channel} · {item.location}</p></div>
            <a href={item.url} target="_blank" rel="noreferrer">Abrir evidencia ↗</a>
          </div>
          <div className={styles.microKpis}>
            <div><span>Detectados</span><strong>{item.metrics.items}</strong></div>
            <div><span>Promos / bundles</span><strong>{item.metrics.promoItems}</strong></div>
            <div><span>Precio entrada</span><strong>{moneyOrDash(item.metrics.lowestPrice)}</strong></div>
            <div><span>Desc. máx.</span><strong>{item.metrics.maxDiscountPct ? `${item.metrics.maxDiscountPct}%` : "—"}</strong></div>
          </div>
          {item.status === "degraded" && <div className={styles.sourceWarning}>La fuente no expuso precios en esta lectura. Se conserva la última captura válida. {item.error || ""}</div>}
          <div className={styles.liveItems}>
            {item.items.map(product => <div className={styles.liveItem} key={product.key}>
              <div><span>{product.category}</span><strong>{product.name}</strong>{product.units && product.units > 1 && product.unitPrice ? <small>{moneyOrDash(product.unitPrice)} por unidad{product.promoMechanic ? ` · ${product.promoMechanic}` : ""}</small> : product.promoMechanic ? <small>{product.promoMechanic}</small> : null}</div>
              <div className={styles.priceCell}><strong>{moneyOrDash(product.currentPrice)}</strong>{product.regularPrice ? <small>Ref. {moneyOrDash(product.regularPrice)}</small> : null}{product.discountPct ? <b>-{product.discountPct}%</b> : product.promotion ? <b>PROMO</b> : null}</div>
            </div>)}
            {!item.items.length && <div className={styles.emptyLive}>No hay precios válidos en la última captura.</div>}
          </div>
        </article>)}
      </div>
    </>}

    {(tab === "products" || tab === "listings") && <div className={styles.filters}>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar producto, SKU, seller o categoría…" />
      {tab === "listings" && <select value={source} onChange={e=>setSource(e.target.value)}><option value="">Todas las fuentes</option>{payload.sources.map(s=><option key={s.id} value={s.domain}>{s.retailer_name}</option>)}</select>}
    </div>}

    {tab === "products" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Catálogo monitoreado</h2><p>Productos de la marca y del set competitivo normalizados para análisis.</p></div><span>{visibleProducts.length} productos</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>SKU / EAN</th><th>Categoría</th><th>Última detección</th></tr></thead><tbody>{visibleProducts.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.sku || p.ean || "—"}</td><td>{p.category || "—"}</td><td>{dateOrDash(p.lastSeenAt)}</td></tr>)}{!visibleProducts.length&&<tr><td colSpan={4} className={styles.empty}>Aún no hay productos capturados.</td></tr>}</tbody></table></div></article>}

    {tab === "retailers" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Fuentes de inteligencia</h2><p>Canales activos y trazables que alimentan el análisis.</p></div></div><div className={styles.cards}>{payload.sources.map(s=><div className={styles.retailCard} key={s.id}><span>{s.source_type}</span><h3>{s.retailer_name}</h3><p>{s.domain}</p><dl><div><dt>Observaciones</dt><dd>{s.listings}</dd></div><div><dt>Precio mín.</dt><dd>{moneyOrDash(s.min_price)}</dd></div><div><dt>Precio máx.</dt><dd>{moneyOrDash(s.max_price)}</dd></div></dl><small>Última captura: {dateOrDash(s.last_crawled_at)}</small>{s.last_error&&<em>{s.last_error}</em>}</div>)}</div></article>}

    {tab === "listings" && <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Evidencia de precios</h2><p>Precio, fuente y timestamp persistidos para auditoría y construcción histórica.</p></div><span>{visibleListings.length} registros actuales</span></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Fuente / Marca</th><th>Precio</th><th>Stock</th><th>Observado</th></tr></thead><tbody>{visibleListings.map(l=><tr key={l.id}><td><a href={l.url} target="_blank" rel="noreferrer"><strong>{l.title}</strong></a></td><td>{l.source}<small className={styles.block}>{l.seller || l.domain}</small></td><td><strong>{moneyOrDash(l.currentPrice)}</strong>{l.regularPrice&&l.currentPrice&&l.regularPrice>l.currentPrice?<small className={styles.block}>Ref. {moneyOrDash(l.regularPrice)}</small>:null}</td><td>{l.inStock===null?"—":l.inStock?"Disponible":"Sin stock"}</td><td>{dateOrDash(l.observedAt)}</td></tr>)}{!visibleListings.length&&<tr><td colSpan={5} className={styles.empty}>Aún no hay evidencia persistida para esta vertical.</td></tr>}</tbody></table></div></article>}
  </section>;
}
