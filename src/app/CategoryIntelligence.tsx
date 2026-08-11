"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./CategoryIntelligence.module.css";

type Filters = { supermarket?: string; period?: number };
type CategoryPayload = {
  source: "clickhouse";
  generatedAt: string;
  selectedCategory: string | null;
  filters?: { retailer: string | null; days: number };
  categories: Array<{ value: string; products: number }>;
  kpis: null | {
    products: number;
    brands: number;
    retailers: number;
    averagePrice: number;
    medianPrice: number;
    variationPct: number | null;
    availabilityPct: number;
    promotions: number;
    promotionPct: number;
    lastObservedAt: string | null;
  };
  trend: Array<{ date: string; retailer: string; medianPrice: number; averagePrice: number; products: number }>;
  brands: Array<{ brand: string; products: number; assortmentSharePct: number; retailers: number; medianPrice: number; averagePrice: number; availabilityPct: number; promotions: number; promotionPct: number }>;
  retailers: Array<{ retailer: string; products: number; brands: number; medianPrice: number; averagePrice: number; priceIndex: number; availabilityPct: number; promotions: number; promotionPct: number }>;
  matrix: Array<{ brand: string; retailer: string; products: number; medianPrice: number; promotionPct: number; availabilityPct: number }>;
  products: Array<{ id: string; name: string; brand: string | null; retailer: string; price: number; regularPrice: number; offerPrice: number; discountPct: number; inStock: boolean; observedAt: string | null }>;
  insights: string[];
  error?: string;
};

type Tab = "overview" | "prices" | "assortment" | "promotions" | "products";
const PALETTE = ["#f1c40f", "#45a3ff", "#35d39a", "#a77bf3", "#ff7b72", "#ff9f43", "#66d9e8", "#b7c0cf"];
const currency = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CL");

function money(value: number) { return currency.format(Number(value || 0)); }
function pct(value: number | null | undefined, digits = 1) { return value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`; }
function shortDate(value: string) { return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", ""); }
function observed(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }

export default function CategoryIntelligence({ filters }: { filters?: Filters }) {
  const [payload, setPayload] = useState<CategoryPayload | null>(null);
  const [category, setCategory] = useState("");
  const [retailer, setRetailer] = useState(filters?.supermarket ?? "");
  const [days, setDays] = useState([7, 30, 90].includes(Number(filters?.period)) ? Number(filters?.period) : 30);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retailerOptions, setRetailerOptions] = useState<string[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productSort, setProductSort] = useState<"price_asc" | "price_desc" | "discount_desc">("price_asc");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    if (category) params.set("category", category);
    if (retailer) params.set("retailer", retailer);
    fetch(`/api/category-intelligence?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as CategoryPayload;
        if (!response.ok) throw new Error(data.error || "No fue posible cargar Category Intelligence");
        setPayload(data);
        if (!category && data.selectedCategory) setCategory(data.selectedCategory);
        if (!retailer && data.retailers.length) setRetailerOptions(data.retailers.map((item) => item.retailer));
        else if (data.retailers.length) setRetailerOptions((current) => [...new Set([...current, ...data.retailers.map((item) => item.retailer)])]);
        setError("");
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Error cargando la categoría");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [category, retailer, days]);

  const productRows = useMemo(() => {
    const q = productQuery.trim().toLocaleLowerCase("es-CL");
    const rows = (payload?.products ?? []).filter((item) => !q || `${item.name} ${item.brand ?? ""} ${item.retailer}`.toLocaleLowerCase("es-CL").includes(q));
    return [...rows].sort((a, b) => productSort === "price_desc" ? b.price - a.price : productSort === "discount_desc" ? b.discountPct - a.discountPct : a.price - b.price);
  }, [payload?.products, productQuery, productSort]);

  const maxProductPrice = Math.max(1, ...productRows.map((item) => item.price));
  const k = payload?.kpis;

  return <section className={styles.root}>
    <header className={styles.hero}>
      <div><span>CATEGORY INTELLIGENCE · CLICKHOUSE</span><h2>Análisis visual de categorías</h2><p>Precios, surtido, promociones y productos en una sola vista analítica.</p></div>
      <div className={styles.source}><i/>100% ClickHouse</div>
    </header>

    <section className={styles.controls}>
      <label><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{(payload?.categories ?? []).map((item) => <option key={item.value} value={item.value}>{item.value} · {integer.format(item.products)} SKU</option>)}</select></label>
      <label><span>Retailer</span><select value={retailer} onChange={(event) => setRetailer(event.target.value)}><option value="">Todos los retailers</option>{retailerOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Período</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label>
      <button onClick={() => { setRetailer(""); setDays(30); setTab("overview"); }}>Restablecer</button>
    </section>

    <nav className={styles.tabs}>
      {([ ["overview", "Visión general"], ["prices", "Precios"], ["assortment", "Surtido"], ["promotions", "Promociones"], ["products", "Productos"] ] as Array<[Tab, string]>).map(([id, label]) => <button key={id} className={tab === id ? styles.activeTab : ""} onClick={() => setTab(id)}>{label}</button>)}
    </nav>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !payload ? <div className={styles.loading}>Construyendo análisis desde ClickHouse…</div> : null}

    {payload && <>
      <section className={styles.kpis}>
        <Kpi label="SKUs monitoreados" value={integer.format(k?.products ?? 0)} detail="Surtido observado"/>
        <Kpi label="Marcas activas" value={integer.format(k?.brands ?? 0)} detail="Con precio vigente"/>
        <Kpi label="Precio mediano" value={money(k?.medianPrice ?? 0)} detail="Mediana de SKU" emphasis/>
        <Kpi label={`Variación ${days}d`} value={pct(k?.variationPct)} detail="Mediana inicio vs hoy" trend={k?.variationPct ?? null}/>
        <Kpi label="En promoción" value={`${(k?.promotionPct ?? 0).toFixed(1)}%`} detail={`${integer.format(k?.promotions ?? 0)} SKU`}/>
        <Kpi label="Disponibilidad" value={`${(k?.availabilityPct ?? 0).toFixed(1)}%`} detail={`Actualizado ${observed(k?.lastObservedAt)}`}/>
      </section>

      {tab === "overview" && <Overview payload={payload}/>} 
      {tab === "prices" && <Prices payload={payload} rows={productRows} maxProductPrice={maxProductPrice}/>} 
      {tab === "assortment" && <Assortment payload={payload}/>} 
      {tab === "promotions" && <Promotions payload={payload}/>} 
      {tab === "products" && <Products rows={productRows} query={productQuery} setQuery={setProductQuery} sort={productSort} setSort={setProductSort} maxPrice={maxProductPrice}/>} 
    </>}
  </section>;
}

function Overview({ payload }: { payload: CategoryPayload }) {
  return <div className={styles.dashboardGrid}>
    <article className={`${styles.card} ${styles.lineCard}`}><CardTitle eyebrow="PRICE TREND" title="Evolución de precio por retailer" copy="Precio mediano diario · evita que outliers dominen la lectura"/><LineChart rows={payload.trend}/></article>
    <article className={styles.card}><CardTitle eyebrow="PRICE POSITION" title="Precio mediano por retailer" copy="Índice 100 = mediana de la categoría"/><RetailerBars rows={payload.retailers}/></article>
    <article className={styles.card}><CardTitle eyebrow="ASSORTMENT MIX" title="Presencia de surtido por marca" copy="% de SKU observados · no representa market share de ventas"/><BrandDonut rows={payload.brands}/></article>
    <article className={`${styles.card} ${styles.stackedCard}`}><CardTitle eyebrow="RETAILER MIX" title="Mix de marcas por retailer" copy="Composición del surtido observado en cada cadena"/><StackedAssortment payload={payload}/></article>
    <article className={`${styles.card} ${styles.insightsCard}`}><CardTitle eyebrow="CATEGORY SIGNALS" title="Qué está pasando en la categoría" copy="Hallazgos calculados desde los datos actuales e históricos"/><div className={styles.insights}>{payload.insights.map((item, index) => <div key={item}><b>{String(index + 1).padStart(2, "0")}</b><p>{item}</p></div>)}</div></article>
  </div>;
}

function Prices({ payload, rows, maxProductPrice }: { payload: CategoryPayload; rows: CategoryPayload["products"]; maxProductPrice: number }) {
  return <div className={styles.dashboardGrid}>
    <article className={`${styles.card} ${styles.lineCard}`}><CardTitle eyebrow="PRICE TREND" title="Evolución histórica" copy="Comparación diaria de medianas entre retailers"/><LineChart rows={payload.trend}/></article>
    <article className={styles.card}><CardTitle eyebrow="RETAILER BENCHMARK" title="Índice de precio" copy="Menor a 100 = más económico que la categoría"/><RetailerBars rows={payload.retailers}/></article>
    <article className={`${styles.card} ${styles.heatCard}`}><CardTitle eyebrow="PRICE HEATMAP" title="Marca × retailer" copy="Mediana de precio por combinación"/><Heatmap payload={payload} metric="price"/></article>
    <article className={`${styles.card} ${styles.productCard}`}><CardTitle eyebrow="PRODUCT PRICE LADDER" title="Precios por producto" copy="Muestra actual de SKU dentro de la categoría"/><ProductLadder rows={rows.slice(0, 24)} maxPrice={maxProductPrice}/></article>
  </div>;
}

function Assortment({ payload }: { payload: CategoryPayload }) {
  return <div className={styles.dashboardGrid}>
    <article className={styles.card}><CardTitle eyebrow="BRAND PRESENCE" title="Presencia de surtido" copy="Distribución de los SKU observados por marca"/><BrandDonut rows={payload.brands}/></article>
    <article className={`${styles.card} ${styles.stackedCard}`}><CardTitle eyebrow="ASSORTMENT COMPOSITION" title="Mix de marcas por retailer" copy="Qué tan concentrado o diversificado está cada retailer"/><StackedAssortment payload={payload}/></article>
    <article className={`${styles.card} ${styles.brandBarsCard}`}><CardTitle eyebrow="BRAND DEPTH" title="Profundidad por marca" copy="SKU observados y cobertura de retailers"/><BrandBars rows={payload.brands}/></article>
    <article className={`${styles.card} ${styles.heatCard}`}><CardTitle eyebrow="AVAILABILITY" title="Disponibilidad marca × retailer" copy="Stock observado por combinación"/><Heatmap payload={payload} metric="availability"/></article>
  </div>;
}

function Promotions({ payload }: { payload: CategoryPayload }) {
  return <div className={styles.dashboardGrid}>
    <article className={styles.card}><CardTitle eyebrow="PROMO BY RETAILER" title="Intensidad promocional" copy="% de SKU con precio oferta bajo precio regular"/><PromoBars rows={payload.retailers.map((row) => ({ label: row.retailer, value: row.promotionPct, detail: `${row.promotions} SKU` }))}/></article>
    <article className={styles.card}><CardTitle eyebrow="PROMO BY BRAND" title="Marcas más promocionadas" copy="Intensidad entre las principales marcas de la categoría"/><PromoBars rows={payload.brands.slice(0, 10).map((row) => ({ label: row.brand, value: row.promotionPct, detail: `${row.promotions} SKU` }))}/></article>
    <article className={`${styles.card} ${styles.heatCard}`}><CardTitle eyebrow="PROMO HEATMAP" title="Promoción marca × retailer" copy="Dónde se concentra la actividad promocional"/><Heatmap payload={payload} metric="promotion"/></article>
    <article className={`${styles.card} ${styles.insightsCard}`}><CardTitle eyebrow="PROMO SIGNALS" title="Lecturas accionables" copy="Señales de ejecución promocional"/><div className={styles.insights}>{payload.insights.slice(0, 4).map((item, index) => <div key={item}><b>{String(index + 1).padStart(2, "0")}</b><p>{item}</p></div>)}</div></article>
  </div>;
}

function Products({ rows, query, setQuery, sort, setSort, maxPrice }: { rows: CategoryPayload["products"]; query: string; setQuery: (value: string) => void; sort: "price_asc" | "price_desc" | "discount_desc"; setSort: (value: "price_asc" | "price_desc" | "discount_desc") => void; maxPrice: number }) {
  return <section className={styles.card}>
    <div className={styles.productToolbar}><div><span>PRODUCT EXPLORER</span><h3>Productos dentro de la categoría</h3></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o marca…"/><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="discount_desc">Mayor descuento</option></select></div>
    <ProductLadder rows={rows} maxPrice={maxPrice}/>
  </section>;
}

function Kpi({ label, value, detail, emphasis = false, trend = null }: { label: string; value: string; detail: string; emphasis?: boolean; trend?: number | null }) {
  return <article className={`${styles.kpi} ${emphasis ? styles.kpiEmphasis : ""}`}><span>{label}</span><strong>{value}</strong><small className={trend === null ? "" : trend >= 0 ? styles.up : styles.down}>{detail}</small></article>;
}

function CardTitle({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className={styles.cardTitle}><span>{eyebrow}</span><h3>{title}</h3><p>{copy}</p></header>;
}

function LineChart({ rows }: { rows: CategoryPayload["trend"] }) {
  const retailerRows = rows.filter((row) => row.retailer !== "__ALL__" && row.medianPrice > 0);
  const retailers = [...new Set(retailerRows.map((row) => row.retailer))].slice(0, 6);
  const dates = [...new Set(retailerRows.map((row) => row.date))].sort();
  const values = retailerRows.filter((row) => retailers.includes(row.retailer)).map((row) => row.medianPrice);
  if (!dates.length || !values.length) return <div className={styles.empty}>Sin histórico suficiente para esta selección.</div>;
  const width = 760, height = 255, left = 58, right = 18, top = 20, bottom = 38;
  const min = Math.min(...values), max = Math.max(...values), spread = Math.max(1, max - min);
  const x = (index: number) => left + index / Math.max(1, dates.length - 1) * (width - left - right);
  const y = (value: number) => top + (max - value) / spread * (height - top - bottom);
  const lookup = new Map(retailerRows.map((row) => [`${row.retailer}|${row.date}`, row.medianPrice]));
  const pathFor = (retailer: string) => dates.map((date, index) => { const value = lookup.get(`${retailer}|${date}`); return value ? `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}` : ""; }).filter(Boolean).join(" ");
  return <div className={styles.lineWrap}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolución de precio por retailer">{[0,1,2,3,4].map((tick) => { const value = max - spread * tick / 4; const yy = y(value); return <g key={tick}><line x1={left} x2={width-right} y1={yy} y2={yy}/><text x={left-8} y={yy+4}>{money(value)}</text></g>; })}{retailers.map((item, index) => <path key={item} d={pathFor(item)} style={{ stroke: PALETTE[index % PALETTE.length] }}/>) }{dates.filter((_, index) => index === 0 || index === dates.length - 1 || index % Math.max(1, Math.ceil(dates.length / 5)) === 0).map((date) => <text className={styles.xLabel} key={date} x={x(dates.indexOf(date))} y={height-10}>{shortDate(date)}</text>)}</svg><footer>{retailers.map((item, index) => <span key={item}><i style={{ background: PALETTE[index % PALETTE.length] }}/>{item}</span>)}</footer></div>;
}

function RetailerBars({ rows }: { rows: CategoryPayload["retailers"] }) {
  const max = Math.max(1, ...rows.map((row) => row.medianPrice));
  return <div className={styles.retailerBars}>{rows.map((row) => <div key={row.retailer}><header><strong>{row.retailer}</strong><b>{money(row.medianPrice)}</b></header><span><i style={{ width: `${Math.max(3, row.medianPrice / max * 100)}%` }}/><em style={{ left: `${Math.min(98, Math.max(2, 100 / Math.max(1, row.priceIndex) * 80))}%` }}/></span><footer>Índice {row.priceIndex.toFixed(1)} · {integer.format(row.products)} SKU · {row.promotionPct.toFixed(1)}% promo</footer></div>)}</div>;
}

function BrandDonut({ rows }: { rows: CategoryPayload["brands"] }) {
  const top = rows.slice(0, 7);
  const used = top.reduce((sum, row) => sum + row.assortmentSharePct, 0);
  const segments = [...top.map((row, index) => ({ label: row.brand, value: row.assortmentSharePct, color: PALETTE[index % PALETTE.length] })), ...(used < 99.5 ? [{ label: "Otras", value: Math.max(0, 100-used), color: "#303946" }] : [])];
  let cursor = 0;
  const gradient = segments.map((segment) => { const start = cursor; cursor += segment.value; return `${segment.color} ${start}% ${cursor}%`; }).join(",");
  return <div className={styles.donutWrap}><div className={styles.donut} style={{ background: `conic-gradient(${gradient})` }}><div><strong>{rows.length}</strong><span>marcas</span></div></div><div className={styles.legend}>{segments.map((segment) => <div key={segment.label}><i style={{ background: segment.color }}/><span>{segment.label}</span><b>{segment.value.toFixed(1)}%</b></div>)}</div></div>;
}

function StackedAssortment({ payload }: { payload: CategoryPayload }) {
  const brands = payload.brands.slice(0, 7).map((row) => row.brand);
  const retailers = payload.retailers.map((row) => row.retailer);
  const matrix = new Map(payload.matrix.map((row) => [`${row.retailer}|${row.brand}`, row.products]));
  return <div className={styles.stacked}>{retailers.map((retailer) => { const values = brands.map((brand) => matrix.get(`${retailer}|${brand}`) ?? 0); const total = Math.max(1, values.reduce((sum, value) => sum + value, 0)); return <div key={retailer}><header><strong>{retailer}</strong><span>{integer.format(total)} SKU top marcas</span></header><div className={styles.stackBar}>{values.map((value, index) => value > 0 ? <i key={brands[index]} title={`${brands[index]}: ${value} SKU`} style={{ width: `${value/total*100}%`, background: PALETTE[index % PALETTE.length] }}/> : null)}</div></div>; })}<footer>{brands.map((brand,index) => <span key={brand}><i style={{ background: PALETTE[index % PALETTE.length] }}/>{brand}</span>)}</footer></div>;
}

function BrandBars({ rows }: { rows: CategoryPayload["brands"] }) {
  const top = rows.slice(0, 12), max = Math.max(1, ...top.map((row) => row.products));
  return <div className={styles.brandBars}>{top.map((row, index) => <div key={row.brand}><span>{row.brand}<small>{row.retailers} retailers</small></span><i><b style={{ width: `${row.products/max*100}%`, background: PALETTE[index % PALETTE.length] }}/></i><strong>{integer.format(row.products)}</strong></div>)}</div>;
}

function PromoBars({ rows }: { rows: Array<{ label: string; value: number; detail: string }> }) {
  return <div className={styles.promoBars}>{rows.map((row) => <div key={row.label}><header><strong>{row.label}</strong><b>{row.value.toFixed(1)}%</b></header><span><i style={{ width: `${Math.min(100, Math.max(1, row.value))}%` }}/></span><small>{row.detail}</small></div>)}</div>;
}

function Heatmap({ payload, metric }: { payload: CategoryPayload; metric: "price" | "promotion" | "availability" }) {
  const brands = payload.brands.slice(0, 8).map((row) => row.brand), retailers = payload.retailers.slice(0, 7).map((row) => row.retailer);
  const map = new Map(payload.matrix.map((row) => [`${row.brand}|${row.retailer}`, row]));
  const prices = payload.matrix.map((row) => row.medianPrice).filter((value) => value > 0), minPrice = Math.min(...prices, 0), maxPrice = Math.max(...prices, 1);
  const format = (row: CategoryPayload["matrix"][number] | undefined) => !row ? "—" : metric === "price" ? money(row.medianPrice) : `${(metric === "promotion" ? row.promotionPct : row.availabilityPct).toFixed(0)}%`;
  const intensity = (row: CategoryPayload["matrix"][number] | undefined) => !row ? 0 : metric === "price" ? (row.medianPrice-minPrice)/Math.max(1,maxPrice-minPrice) : (metric === "promotion" ? row.promotionPct : row.availabilityPct)/100;
  return <div className={styles.heatmap}><div className={styles.heatHeader}><span/>{retailers.map((item) => <b key={item}>{item}</b>)}</div>{brands.map((brand) => <div className={styles.heatRow} key={brand}><strong>{brand}</strong>{retailers.map((retailer) => { const row = map.get(`${brand}|${retailer}`); const level = intensity(row); return <span key={retailer} style={{ background: row ? `rgba(241,196,15,${0.08 + level*0.62})` : undefined }} title={row ? `${brand} · ${retailer} · ${row.products} SKU` : "Sin datos"}>{format(row)}</span>; })}</div>)}</div>;
}

function ProductLadder({ rows, maxPrice }: { rows: CategoryPayload["products"]; maxPrice: number }) {
  if (!rows.length) return <div className={styles.empty}>No hay productos con la selección actual.</div>;
  return <div className={styles.productLadder}>{rows.map((row) => <div key={`${row.id}-${row.retailer}`}><section><strong>{row.name}</strong><small>{row.brand || "Sin marca"} · {row.retailer}</small></section><span className={styles.priceTrack}><i style={{ width: `${Math.max(2, row.price/Math.max(1,maxPrice)*100)}%` }}/></span><b>{money(row.price)}</b><em className={row.discountPct > 0 ? styles.promoTag : ""}>{row.discountPct > 0 ? `-${row.discountPct.toFixed(0)}%` : row.inStock ? "Stock" : "Sin stock"}</em></div>)}</div>;
}
