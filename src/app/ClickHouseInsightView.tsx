"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ClickHouseInsightView.module.css";

export type ClickHouseInsightMode =
  | "price-evolution"
  | "retailer-benchmark"
  | "market-coverage"
  | "price-gaps"
  | "price-alerts"
  | "products"
  | "data-status";

type BrandOption = { value: string; products: number };
type ProductOption = { id: string; name: string; brand: string; retailer: string; latestPrice: number; lastObservedAt: string | null };
type EvolutionSeries = { retailer: string; points: Array<{ date: string; price: number; products: number }> };
type Retailer = { retailer: string; products: number; medianPrice: number; averagePrice: number; minPrice: number; maxPrice: number; inStock: number; availabilityPct: number; lastObservedAt: string | null };
type Gap = { brand: string; category: string; retailers: number; products: number; lowRetailer: string; highRetailer: string; lowPrice: number; highPrice: number; gapPct: number };
type Alert = { name: string; brand: string | null; retailer: string; previousPrice: number; currentPrice: number; changePct: number; observedAt: string | null };
type Product = { id: string; name: string; brand: string | null; category: string | null; retailer: string; price: number; regularPrice: number; inStock: boolean; observedAt: string | null; url: string };
type DataStatus = { retailer: string; products: number; latestObservedAt: string | null; observations24h: number };
type Payload = {
  source: "clickhouse";
  mode: ClickHouseInsightMode;
  generatedAt: string;
  series?: EvolutionSeries[];
  retailers?: Retailer[] | DataStatus[];
  gaps?: Gap[];
  alerts?: Alert[];
  products?: Product[];
  error?: string;
};

const COLORS = ["#f5c400", "#4f9cf9", "#60c77a", "#d978e8", "#f08154", "#63d5d1", "#a78bfa", "#e5e7eb"];
const moneyFormat = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });

const META: Record<ClickHouseInsightMode, { eyebrow: string; title: string; copy: string }> = {
  "price-evolution": { eyebrow: "PRICE EVOLUTION", title: "Evolución de precios", copy: "Histórico por retailer para la marca o producto seleccionado." },
  "retailer-benchmark": { eyebrow: "RETAILER BENCHMARK", title: "Benchmark por retailer", copy: "Compara mediana, rango de precios y cobertura entre retailers." },
  "market-coverage": { eyebrow: "MARKET COVERAGE", title: "Cobertura de mercado", copy: "Profundidad de catálogo y disponibilidad del universo seleccionado." },
  "price-gaps": { eyebrow: "PRICE GAPS", title: "Brechas de precio", copy: "Detecta dónde aparecen las mayores diferencias de precio entre retailers." },
  "price-alerts": { eyebrow: "PRICE MOVEMENTS", title: "Movimientos y alertas", copy: "Alzas y bajas detectadas entre el día actual y el anterior." },
  products: { eyebrow: "PRODUCT EXPLORER", title: "Productos", copy: "Explora precios actuales directamente desde ClickHouse." },
  "data-status": { eyebrow: "DATA STATUS", title: "Estado de datos", copy: "Freshness y cobertura de observaciones por retailer." },
};

function money(value: number) { return moneyFormat.format(Number.isFinite(value) ? value : 0); }
function num(value: number) { return integer.format(Number.isFinite(value) ? value : 0); }
function short(value: number) { return compact.format(Number.isFinite(value) ? value : 0); }
function pct(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`; }
function shortDate(value: string) { try { return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", ""); } catch { return value; } }
function timeAgo(value: string | null | undefined) {
  if (!value) return "sin datos";
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 60_000) return "ahora";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function EvolutionChart({ series }: { series: EvolutionSeries[] }) {
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const values = series.flatMap((item) => item.points.map((point) => point.price)).filter((value) => value > 0);
  if (!dates.length || !values.length) return <Empty text="No hay histórico suficiente para este filtro."/>;
  const width = 960; const height = 350; const margin = { top: 22, right: 22, bottom: 48, left: 72 };
  const plotWidth = width - margin.left - margin.right; const plotHeight = height - margin.top - margin.bottom;
  const rawMin = Math.min(...values); const rawMax = Math.max(...values); const pad = Math.max(1, (rawMax - rawMin) * .15, rawMax * .02);
  const min = Math.max(0, rawMin - pad); const max = rawMax + pad;
  const x = (i: number) => margin.left + i / Math.max(1, dates.length - 1) * plotWidth;
  const y = (v: number) => margin.top + (max - v) / Math.max(1, max - min) * plotHeight;
  return <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.lineChart}>
      {[0,1,2,3,4].map((i) => { const value = max - i * (max - min) / 4; const yy = y(value); return <g key={i}><line x1={margin.left} x2={width-margin.right} y1={yy} y2={yy}/><text x={margin.left-12} y={yy+4}>{money(value)}</text></g>; })}
      {series.slice(0,8).map((item,index) => { const map = new Map(item.points.map((p) => [p.date,p.price])); let drawing = false; const path = dates.map((date,i) => { const value = map.get(date); if (!value) { drawing=false; return ""; } const cmd = drawing ? "L" : "M"; drawing=true; return `${cmd}${x(i).toFixed(1)},${y(value).toFixed(1)}`; }).join(" "); return <path key={item.retailer} d={path} style={{ stroke: COLORS[index % COLORS.length] }}/>; })}
      {dates.filter((_,i) => i===0 || i===dates.length-1 || i % Math.max(1, Math.floor(dates.length/5))===0).map((date) => <text className={styles.xLabel} key={date} x={x(dates.indexOf(date))} y={height-12}>{shortDate(date)}</text>)}
    </svg>
    <div className={styles.legend}>{series.slice(0,8).map((item,index) => <span key={item.retailer}><i style={{background:COLORS[index % COLORS.length]}}/>{item.retailer}</span>)}</div>
  </div>;
}

function RetailerBars({ rows, coverage = false }: { rows: Retailer[]; coverage?: boolean }) {
  if (!rows.length) return <Empty text="No hay retailers con datos para este filtro."/>;
  const sorted = [...rows].sort((a,b) => coverage ? b.products-a.products : a.medianPrice-b.medianPrice);
  const max = Math.max(...sorted.map((row) => coverage ? row.products : row.medianPrice),1);
  return <div className={styles.horizontalBars}>{sorted.map((row,index) => {
    const value = coverage ? row.products : row.medianPrice;
    return <div key={row.retailer} className={styles.horizontalRow}><header><strong>{row.retailer}</strong><span>{coverage ? `${short(row.products)} SKU` : money(row.medianPrice)}</span></header><div><i style={{width:`${Math.max(5,value/max*100)}%`,background:index===0?"#f5c400":undefined}}/></div><footer>{coverage ? `${row.availabilityPct.toFixed(1)}% disponibilidad` : `${short(row.products)} SKU · ${row.availabilityPct.toFixed(1)}% disponibilidad`}</footer></div>;
  })}</div>;
}

function Empty({ text }: { text: string }) { return <div className={styles.empty}>{text}</div>; }

export default function ClickHouseInsightView({ mode }: { mode: ClickHouseInsightMode }) {
  const [brands,setBrands] = useState<BrandOption[]>([]);
  const [brand,setBrand] = useState("");
  const [products,setProducts] = useState<ProductOption[]>([]);
  const [product,setProduct] = useState("");
  const [days,setDays] = useState(30);
  const [payload,setPayload] = useState<Payload|null>(null);
  const [loading,setLoading] = useState(true);
  const [filterLoading,setFilterLoading] = useState(false);
  const [error,setError] = useState("");
  const meta = META[mode];

  useEffect(() => {
    const cached = typeof window !== "undefined" ? window.sessionStorage.getItem("mgp_ch_brands_v1") : null;
    if (cached) { try { setBrands(JSON.parse(cached) as BrandOption[]); return; } catch { /* reload */ } }
    const controller = new AbortController();
    fetch("/api/clickhouse-insight?options=brands", { signal: controller.signal })
      .then(async (response) => { const data = await response.json() as { brands?: BrandOption[]; error?: string }; if (!response.ok) throw new Error(data.error || "No fue posible cargar marcas"); const rows=data.brands??[]; setBrands(rows); window.sessionStorage.setItem("mgp_ch_brands_v1",JSON.stringify(rows)); })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar marcas"); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setProduct(""); setProducts([]);
    if (!brand) return;
    const key = `mgp_ch_products_v1:${brand}`;
    const cached = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
    if (cached) { try { setProducts(JSON.parse(cached) as ProductOption[]); return; } catch { /* reload */ } }
    const controller = new AbortController(); setFilterLoading(true);
    fetch(`/api/clickhouse-insight?options=products&brand=${encodeURIComponent(brand)}`, { signal: controller.signal })
      .then(async (response) => { const data = await response.json() as { products?: ProductOption[]; error?: string }; if (!response.ok) throw new Error(data.error || "No fue posible cargar productos"); const rows=data.products??[]; setProducts(rows); window.sessionStorage.setItem(key,JSON.stringify(rows)); })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar productos"); })
      .finally(() => setFilterLoading(false));
    return () => controller.abort();
  }, [brand]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ mode, days:String(days) });
    if (brand) params.set("brand",brand);
    const selected = products.find((item) => item.id===product);
    if (selected) params.set("product",selected.name);
    setLoading(true); setError("");
    fetch(`/api/clickhouse-insight?${params.toString()}`, { signal:controller.signal })
      .then(async (response) => { const data = await response.json() as Payload; if (!response.ok || data.source!=="clickhouse") throw new Error(data.error || "No fue posible cargar ClickHouse"); setPayload(data); })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar el análisis"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [mode,brand,product,days,products]);

  const selectedProduct = products.find((item) => item.id===product);
  const retailerRows = (payload?.retailers ?? []) as Retailer[];
  const statusRows = (payload?.retailers ?? []) as DataStatus[];
  const summary = useMemo(() => {
    if (mode==="retailer-benchmark" || mode==="market-coverage") {
      const rows=retailerRows; const total=rows.reduce((sum,row)=>sum+row.products,0); const median=rows.length?[...rows].sort((a,b)=>a.medianPrice-b.medianPrice)[Math.floor(rows.length/2)]?.medianPrice??0:0;
      return [{label:"Retailers",value:num(rows.length)},{label:"Productos",value:short(total)},{label:"Mediana de retailers",value:money(median)}];
    }
    if (mode==="price-alerts") { const rows=payload?.alerts??[]; return [{label:"Movimientos",value:num(rows.length)},{label:"Bajas",value:num(rows.filter((r)=>r.changePct<0).length)},{label:"Alzas",value:num(rows.filter((r)=>r.changePct>0).length)}]; }
    if (mode==="price-gaps") { const rows=payload?.gaps??[]; return [{label:"Brechas",value:num(rows.length)},{label:"Mayor brecha",value:rows.length?`${Math.max(...rows.map((r)=>r.gapPct)).toFixed(1)}%`:"—"},{label:"Universo",value:selectedProduct?"Producto":brand?"Marca":"Mercado"}]; }
    if (mode==="products") { const rows=payload?.products??[]; return [{label:"Resultados",value:num(rows.length)},{label:"Con stock",value:num(rows.filter((r)=>r.inStock).length)},{label:"Retailers",value:num(new Set(rows.map((r)=>r.retailer)).size)}]; }
    if (mode==="data-status") { return [{label:"Retailers",value:num(statusRows.length)},{label:"Activos 24h",value:num(statusRows.filter((r)=>r.observations24h>0).length)},{label:"Productos",value:short(statusRows.reduce((s,r)=>s+r.products,0))}]; }
    const rows=payload?.series??[]; return [{label:"Retailers",value:num(rows.length)},{label:"Series",value:num(rows.length)},{label:"Período",value:`${days} días`}];
  }, [mode,payload,retailerRows,statusRows,selectedProduct,brand,days]);

  return <section className={styles.root}>
    <header className={styles.hero}><div><span>{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.copy}</p></div><div className={styles.source}><i/>CLICKHOUSE LIVE</div></header>
    <section className={styles.filters}>
      <label><span>Marca</span><select value={brand} onChange={(e)=>setBrand(e.target.value)}><option value="">Todas las marcas</option>{brands.map((item)=><option key={item.value} value={item.value}>{item.value} · {short(item.products)}</option>)}</select></label>
      <label className={styles.productFilter}><span>Producto</span><select disabled={!brand || filterLoading} value={product} onChange={(e)=>setProduct(e.target.value)}><option value="">{!brand?"Selecciona primero una marca":filterLoading?"Cargando productos…":"Todos los productos de la marca"}</option>{products.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.retailer} · {money(item.latestPrice)}</option>)}</select></label>
      <label><span>Período</span><select value={days} onChange={(e)=>setDays(Number(e.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label>
      <button onClick={()=>{setBrand("");setProduct("");setDays(30);}}>Limpiar</button>
    </section>
    {selectedProduct && <div className={styles.context}><span>PRODUCTO ACTIVO</span><strong>{selectedProduct.brand} · {selectedProduct.name}</strong><em>{selectedProduct.retailer}</em></div>}
    {error && <div className={styles.error}>{error}</div>}
    <section className={styles.kpis}>{summary.map((item)=><article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</section>
    <article className={styles.card}>
      {loading ? <div className={styles.loading}><i/><span>Consultando ClickHouse…</span></div> : <InsightBody mode={mode} payload={payload} />}
    </article>
    <footer className={styles.footer}>Esta vista consulta únicamente el dataset necesario para el módulo activo. No precarga otros módulos.</footer>
  </section>;
}

function InsightBody({mode,payload}:{mode:ClickHouseInsightMode;payload:Payload|null}) {
  if (!payload) return <Empty text="Sin datos."/>;
  if (mode==="price-evolution") return <EvolutionChart series={payload.series??[]}/>;
  if (mode==="retailer-benchmark") return <RetailerBars rows={(payload.retailers??[]) as Retailer[]}/>;
  if (mode==="market-coverage") return <RetailerBars rows={(payload.retailers??[]) as Retailer[]} coverage/>;
  if (mode==="price-gaps") {
    const rows=payload.gaps??[]; if(!rows.length)return <Empty text="No hay brechas comparables con el filtro seleccionado."/>;
    return <div className={styles.gapGrid}>{rows.map((row)=><div key={`${row.brand}-${row.category}`}><header><span><b>{row.brand}</b><small>{row.category} · {short(row.products)} SKU</small></span><em>+{row.gapPct.toFixed(1)}%</em></header><section><div><small>MENOR</small><strong>{money(row.lowPrice)}</strong><span>{row.lowRetailer}</span></div><i>→</i><div><small>MAYOR</small><strong>{money(row.highPrice)}</strong><span>{row.highRetailer}</span></div></section></div>)}</div>;
  }
  if (mode==="price-alerts") {
    const rows=payload.alerts??[]; if(!rows.length)return <Empty text="No hay cambios diarios comparables para este filtro."/>;
    const max=Math.max(...rows.map((r)=>Math.abs(r.changePct)),1);
    return <div className={styles.alertList}>{rows.map((row)=><div key={`${row.retailer}-${row.name}`}><span className={row.changePct<0?styles.down:styles.up}>{row.changePct<0?"↓":"↑"}</span><section><strong>{row.name}</strong><small>{row.brand||"Sin marca"} · {row.retailer}</small><i><em style={{width:`${Math.max(4,Math.abs(row.changePct)/max*100)}%`}}/></i></section><div><b>{pct(row.changePct)}</b><small>{money(row.previousPrice)} → {money(row.currentPrice)}</small></div></div>)}</div>;
  }
  if (mode==="products") {
    const rows=payload.products??[]; if(!rows.length)return <Empty text="No hay productos con el filtro seleccionado."/>;
    return <div className={styles.productGrid}>{rows.map((row)=><a key={row.id} href={row.url} target="_blank" rel="noreferrer"><header><span>{row.brand||"Sin marca"}</span><em>{row.retailer}</em></header><strong>{row.name}</strong><small>{row.category||"Sin categoría"}</small><footer><b>{money(row.price)}</b><span className={row.inStock?styles.stock:styles.noStock}>{row.inStock?"Disponible":"Sin stock"}</span></footer></a>)}</div>;
  }
  const rows=(payload.retailers??[]) as DataStatus[]; if(!rows.length)return <Empty text="No hay fuentes para mostrar."/>;
  return <div className={styles.statusGrid}>{rows.map((row)=><article key={row.retailer}><header><i className={row.observations24h>0?styles.live:styles.stale}/><strong>{row.retailer}</strong></header><b>{short(row.products)} productos</b><span>{short(row.observations24h)} actualizados en 24h</span><small>Última observación {timeAgo(row.latestObservedAt)}</small></article>)}</div>;
}
