import fs from "node:fs";

const componentPath = "src/app/ClickHouseOverview.tsx";
const cssPath = "src/app/ClickHouseOverview.module.css";
let source = fs.readFileSync(componentPath, "utf8");
const marker = "/* product-price-comparison-v2 */";

if (!source.includes("type ProductTrendOption =")) {
  source = source.replace(
    'type TrendPoint = { date: string; averagePrice: number; medianPrice: number; products: number };',
    `type TrendPoint = { date: string; averagePrice: number; medianPrice: number; products: number };
type ProductTrendOption = {
  id: string;
  name: string;
  brand: string;
  retailer: string;
  latestPrice: number;
  lastObservedAt: string | null;
};
type ProductTrendSeries = ProductTrendOption & { points: Array<{ date: string; price: number }> };`,
  );
}

if (!source.includes("const PRODUCT_SERIES_COLORS")) {
  source = source.replace(
    'const compactFormatter = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });',
    'const compactFormatter = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });\nconst PRODUCT_SERIES_COLORS = ["#f5c400", "#4f9cf9", "#61c876", "#d978e8"];',
  );
}

if (!source.includes("function ProductComparisonChart")) {
  const anchor = "function RetailerBars({ rows }: { rows: Retailer[] }) {";
  if (!source.includes(anchor)) throw new Error("RetailerBars anchor not found");
  const chart = `function ProductComparisonChart({ series }: { series: ProductTrendSeries[] }) {
  if (!series.length) return <div className={styles.emptyChart}>Selecciona una marca y un producto para comenzar. Puedes comparar hasta 4 productos.</div>;
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const allValues = series.flatMap((item) => item.points.map((point) => point.price)).filter((value) => value > 0 && Number.isFinite(value));
  if (!dates.length || !allValues.length) return <div className={styles.emptyChart}>Los productos seleccionados todavía no tienen histórico suficiente.</div>;
  const width = 760;
  const height = 260;
  const margin = { top: 18, right: 18, bottom: 34, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const pad = Math.max(1, (rawMax - rawMin) * .14, rawMax * .02);
  const min = Math.max(0, rawMin - pad);
  const max = rawMax + pad;
  const x = (index: number) => margin.left + index / Math.max(1, dates.length - 1) * plotWidth;
  const y = (value: number) => margin.top + (max - value) / Math.max(1, max - min) * plotHeight;
  const paths = series.map((item) => {
    const valueMap = new Map(item.points.map((point) => [point.date, point.price]));
    const segments: string[] = [];
    let drawing = false;
    dates.forEach((date, index) => {
      const value = valueMap.get(date);
      if (!value || value <= 0) { drawing = false; return; }
      segments.push(\`${"${drawing ? \"L\" : \"M\"}"}${"${x(index).toFixed(1)}"},${"${y(value).toFixed(1)}"}\`);
      drawing = true;
    });
    return { item, path: segments.join(" "), valueMap };
  });
  const labels = dates.filter((_, index) => index === 0 || index === dates.length - 1 || index % Math.max(1, Math.floor(dates.length / 4)) === 0);
  return <div className={styles.lineChartWrap}>
    <svg viewBox={\`0 0 ${"${width}"} ${"${height}"}\`} className={styles.lineChart} role="img" aria-label="Evolución comparativa de precios por producto">
      {[0, 1, 2, 3].map((index) => {
        const value = max - index * (max - min) / 3;
        const yy = y(value);
        return <g key={index}><line x1={margin.left} x2={width - margin.right} y1={yy} y2={yy}/><text x={margin.left - 10} y={yy + 4}>{money(value)}</text></g>;
      })}
      {paths.map(({ item, path }, index) => <path key={item.id} d={path} style={{ stroke: PRODUCT_SERIES_COLORS[index % PRODUCT_SERIES_COLORS.length] }}/>) }
      {paths.map(({ item, valueMap }, seriesIndex) => dates.map((date, dateIndex) => {
        const value = valueMap.get(date);
        if (!value || value <= 0) return null;
        return <circle key={\`${"${item.id}"}-${"${date}"}\`} cx={x(dateIndex)} cy={y(value)} r={dateIndex === dates.length - 1 ? 3.6 : 2} style={{ fill: PRODUCT_SERIES_COLORS[seriesIndex % PRODUCT_SERIES_COLORS.length] }}/>;
      }))}
      {labels.map((date) => <text className={styles.xLabel} key={date} x={x(dates.indexOf(date))} y={height - 9}>{shortDate(date)}</text>)}
    </svg>
    <div className={styles.productLegend}>{series.map((item, index) => <span key={item.id}><i style={{ background: PRODUCT_SERIES_COLORS[index % PRODUCT_SERIES_COLORS.length] }}/><b>{item.brand}</b><small>{item.name} · {item.retailer}</small></span>)}</div>
  </div>;
}

`;
  source = source.replace(anchor, `${chart}${anchor}`);
}

const oldStates = `  const [retailer, setRetailer] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [days, setDays] = useState(30);`;
const newStates = `  const [days, setDays] = useState(30);
  const [trendBrands, setTrendBrands] = useState<Option[]>([]);
  const [trendBrand, setTrendBrand] = useState("");
  const [trendProducts, setTrendProducts] = useState<ProductTrendOption[]>([]);
  const [trendProductId, setTrendProductId] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<ProductTrendOption[]>([]);
  const [productSeries, setProductSeries] = useState<ProductTrendSeries[]>([]);
  const [productTrendLoading, setProductTrendLoading] = useState(false);`;
if (source.includes(oldStates)) source = source.replace(oldStates, newStates);

const contextualLoad = `    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    const effectiveCategory = category || aiContext?.category || "";
    const effectiveBrand = brand || aiContext?.brand || "";
    if (aiContext?.query) params.set("query", aiContext.query);
    if (retailer) params.set("retailer", retailer);
    if (effectiveCategory) params.set("category", effectiveCategory);
    if (effectiveBrand) params.set("brand", effectiveBrand);`;
const aiOnlyLoad = `    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    if (aiContext?.query) params.set("query", aiContext.query);
    if (aiContext?.category) params.set("category", aiContext.category);
    if (aiContext?.brand) params.set("brand", aiContext.brand);
    if (aiContext?.retailers?.length === 1) params.set("retailer", aiContext.retailers[0]);`;
if (source.includes(contextualLoad)) source = source.replace(contextualLoad, aiOnlyLoad);
source = source.replace(
  `    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    if (retailer) params.set("retailer", retailer);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);`,
  `    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });`,
);
source = source.replace("  }, [retailer, category, brand, days, aiContext]);", "  }, [days, aiContext]);");
source = source.replace("  }, [retailer, category, brand, days]);", "  }, [days]);");

if (!source.includes("mode=brands")) {
  const refreshEffect = `  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);`;
  if (!source.includes(refreshEffect)) throw new Error("Refresh effect anchor not found");
  source = source.replace(refreshEffect, `${refreshEffect}

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/product-price-trends?mode=brands", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { brands?: Option[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No fue posible cargar marcas");
        setTrendBrands(data.brands ?? []);
      })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar marcas"); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setTrendProductId("");
    if (!trendBrand) { setTrendProducts([]); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ mode: "products", brand: trendBrand });
    fetch(\`/api/product-price-trends?${"${params.toString()}"}\`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { products?: ProductTrendOption[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No fue posible cargar productos");
        setTrendProducts(data.products ?? []);
      })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar productos"); });
    return () => controller.abort();
  }, [trendBrand]);

  const selectedProductKey = selectedProducts.map((item) => item.id).join("|");
  useEffect(() => {
    if (!selectedProducts.length) { setProductSeries([]); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ mode: "series", days: String(days), live: String(Date.now()) });
    selectedProducts.slice(0, 4).forEach((item) => params.append("product", item.id));
    setProductTrendLoading(true);
    fetch(\`/api/product-price-trends?${"${params.toString()}"}\`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { series?: ProductTrendSeries[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No fue posible cargar la evolución de productos");
        setProductSeries(data.series ?? []);
      })
      .catch((err) => { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "No fue posible cargar la evolución de productos"); })
      .finally(() => setProductTrendLoading(false));
    return () => controller.abort();
  }, [selectedProductKey, days]);`);
}

const filterBlock = /    <section className=\{styles\.filters\}>[\s\S]*?    <\/section>/;
if (filterBlock.test(source)) {
  source = source.replace(filterBlock, `    <section className={styles.productTrendFilters}>
      <label><span>Marca</span><select value={trendBrand} onChange={(event) => setTrendBrand(event.target.value)}><option value="">Selecciona una marca</option>{trendBrands.map((item) => <option key={item.value} value={item.value}>{item.value} · {compact(item.products)}</option>)}</select></label>
      <label className={styles.productSelect}><span>Producto</span><select value={trendProductId} disabled={!trendBrand} onChange={(event) => setTrendProductId(event.target.value)}><option value="">{trendBrand ? "Selecciona un producto" : "Primero selecciona una marca"}</option>{trendProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.retailer} · {money(item.latestPrice)}</option>)}</select></label>
      <label><span>Período</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option></select></label>
      <button className={styles.addProduct} disabled={!trendProductId || selectedProducts.length >= 4 || selectedProducts.some((item) => item.id === trendProductId)} onClick={() => { const product = trendProducts.find((item) => item.id === trendProductId); if (!product) return; setSelectedProducts((current) => current.length >= 4 || current.some((item) => item.id === product.id) ? current : [...current, product]); setTrendProductId(""); }}>+ Agregar al gráfico</button>
      <div className={styles.selectedSeries}>{selectedProducts.length ? selectedProducts.map((item, index) => <button key={item.id} onClick={() => setSelectedProducts((current) => current.filter((product) => product.id !== item.id))}><i style={{ background: PRODUCT_SERIES_COLORS[index % PRODUCT_SERIES_COLORS.length] }}/><span><b>{item.brand}</b><small>{item.name} · {item.retailer}</small></span><em>×</em></button>) : <p>Selecciona hasta 4 productos para comparar su evolución de precio.</p>}</div>
    </section>`);
}

source = source.replace('filters={{ retailer, category, brand, days }}', 'filters={{ retailer: "", category: "", brand: "", days }}');

const oldTrendCard = `<article className={\`${"${styles.card}"} ${"${styles.trendCard}"}\`}>
          <header className={styles.cardHead}><div><span>PRICE EVOLUTION</span><h2>Evolución del precio mediano</h2><p>Histórico diario sobre el alcance seleccionado.</p></div><button onClick={() => onNavigate("movements")}>Ver monitoreo →</button></header>
          <LineChart points={payload.trend}/>
        </article>`;
const newTrendCard = `<article className={\`${"${styles.card}"} ${"${styles.trendCard}"}\`}>
          <header className={styles.cardHead}><div><span>PRODUCT PRICE EVOLUTION</span><h2>Evolución de precios por producto</h2><p>Selecciona y compara hasta 4 productos. Cada línea corresponde a un SKU/retailer real en ClickHouse.</p></div></header>
          {productTrendLoading && selectedProducts.length > 0 ? <div className={styles.chartLoading}>Actualizando histórico desde ClickHouse…</div> : <ProductComparisonChart series={productSeries}/>} 
        </article>`;
if (source.includes(oldTrendCard)) source = source.replace(oldTrendCard, newTrendCard);

if (source.includes('className={styles.filters}')) throw new Error("Legacy overview filter bar is still active");
if (source.includes('Ver monitoreo →')) throw new Error("Ver monitoreo link is still active in Overview");
if (source.includes('filters={{ retailer, category, brand, days }}')) throw new Error("Dashboard chat still references retired manual filters");
if (!source.includes("ProductComparisonChart") || !source.includes("Agregar al gráfico")) throw new Error("Product comparison UI was not installed");

fs.writeFileSync(componentPath, source);

let css = fs.readFileSync(cssPath, "utf8");
if (!css.includes(marker)) {
  css += `\n${marker}\n.productTrendFilters{display:grid;grid-template-columns:minmax(170px,.8fr) minmax(360px,1.8fr) minmax(140px,.65fr) auto;gap:9px;align-items:end;margin-bottom:14px;padding:12px;border:1px solid #232a34;border-radius:11px;background:#0f141a}.productTrendFilters label{display:grid;gap:5px}.productTrendFilters label>span{color:#858f9e;font-size:9px;font-weight:850;letter-spacing:.035em;text-transform:uppercase}.productTrendFilters select{width:100%;height:39px;padding:0 10px;border:1px solid #2b333e;border-radius:8px;outline:0;background:#151b23;color:#e6eaf0;font-size:11px}.productTrendFilters select:disabled{opacity:.5;cursor:not-allowed}.productTrendFilters select:focus{border-color:#746718;box-shadow:0 0 0 2px rgba(245,196,0,.07)}.addProduct{height:39px;padding:0 14px;border:1px solid #5b4d0d;border-radius:8px;background:#26210d;color:#f5cf24;font-size:10px;font-weight:850;white-space:nowrap}.addProduct:disabled{opacity:.42;cursor:not-allowed}.selectedSeries{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:7px;min-height:30px;padding-top:2px}.selectedSeries>p{margin:7px 0 0;color:#66717f;font-size:9px}.selectedSeries>button{display:flex;align-items:center;gap:7px;max-width:330px;padding:6px 8px;border:1px solid #2a323c;border-radius:8px;background:#121820;color:#d9dee5;text-align:left}.selectedSeries>button>i{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.selectedSeries>button>span{min-width:0;display:grid}.selectedSeries>button b{font-size:8.5px}.selectedSeries>button small{margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#778291;font-size:7.5px}.selectedSeries>button em{margin-left:auto;color:#87909b;font-size:13px;font-style:normal}.productLegend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;padding:0 8px 4px}.productLegend span{display:grid;grid-template-columns:12px auto;grid-template-rows:auto auto;column-gap:6px;min-width:0;color:#7b8695}.productLegend span i{grid-row:1/3;align-self:center;width:9px;height:9px;border-radius:50%}.productLegend span b{color:#bfc6cf;font-size:8px}.productLegend span small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#66717f;font-size:7.5px}.chartLoading{display:grid;place-items:center;min-height:270px;color:#8b95a3;font-size:10px}@media(max-width:1050px){.productTrendFilters{grid-template-columns:repeat(2,minmax(0,1fr))}.addProduct{width:100%}}@media(max-width:640px){.productTrendFilters{grid-template-columns:1fr}.selectedSeries{grid-column:auto}.productLegend{grid-template-columns:1fr}}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log("ClickHouse product price comparison v2 applied");
