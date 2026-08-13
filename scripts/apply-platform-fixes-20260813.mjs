import fs from "node:fs";

// 1) Use the complete ClickHouse insight explorer and simplify sidebar.
const appPath="src/app/UnifiedPlatformApp.tsx";
let app=fs.readFileSync(appPath,"utf8");
app=app.replace('from "./ClickHouseInsightView";','from "./ClickHouseInsightViewV2";');
app=app.replace('    { view: "retailer-benchmark", label: "Benchmark retailers", icon: "▥" },\n','');
app=app.replace('    { view: "market-coverage", label: "Cobertura de mercado", icon: "◫" },\n','');
if(app.includes('label: "Benchmark retailers"'))throw new Error("Benchmark still visible in sidebar");
if(app.includes('label: "Cobertura de mercado"'))throw new Error("Market coverage still visible in sidebar");
if(!app.includes('from "./ClickHouseInsightViewV2";'))throw new Error("Insight V2 import not active");
fs.writeFileSync(appPath,app);

// 2) Show a true all-retailer product mix in Category Intelligence.
const categoryPath="src/app/CategoryIntelligence.tsx";
let category=fs.readFileSync(categoryPath,"utf8");
if(!category.includes('import CategoryRetailerMixV2 from "./CategoryRetailerMixV2";')){
  category=category.replace('import styles from "./CategoryIntelligence.module.css";','import styles from "./CategoryIntelligence.module.css";\nimport CategoryRetailerMixV2 from "./CategoryRetailerMixV2";');
}
category=category.replace('<article className={`${styles.card} ${styles.stackedCard}`}><CardTitle eyebrow="RETAILER MIX" title="Mix de marcas por retailer" copy="Composición del surtido observado en cada cadena"/><StackedAssortment payload={payload}/></article>','<article className={`${styles.card} ${styles.stackedCard}`}><CardTitle eyebrow="RETAILER MIX" title="Mix de productos por retailer" copy="Incluye supermercados, multitiendas, farmacias y Home Improvement cuando existen SKU en la categoría."/><CategoryRetailerMixV2 rows={payload.retailers}/></article>');
if(!category.includes('title="Mix de productos por retailer"'))throw new Error("Category retailer product mix not mounted");
fs.writeFileSync(categoryPath,category);

// 3) Mount Brands > Precios beside Competencia.
const brandsPath="src/app/BrandsVertical.tsx";
let brands=fs.readFileSync(brandsPath,"utf8");
if(!brands.includes('import BrandsPricesV2 from "./BrandsPricesV2";')){
  const style='import styles from "./BrandsVertical.module.css";';
  if(!brands.includes(style))throw new Error("Brands style import missing");
  brands=brands.replace(style,`${style}\nimport BrandsPricesV2 from "./BrandsPricesV2";`);
}
brands=brands.replace('type Tab = "overview" | "competition" | "products" | "retailers" | "listings";','type Tab = "overview" | "competition" | "prices" | "products" | "retailers" | "listings";');
brands=brands.replace('[["overview","Overview"],["competition","Competencia"],["products","Productos"]','[["overview","Overview"],["competition","Competencia"],["prices","Precios"],["products","Productos"]');
const filtersAnchor='    {(tab === "products" || tab === "listings") && <div className={styles.filters}>';
if(!brands.includes('tab === "prices" && <BrandsPricesV2/>')){
  if(!brands.includes(filtersAnchor))throw new Error("Brands prices anchor missing");
  brands=brands.replace(filtersAnchor,'    {tab === "prices" && <BrandsPricesV2/>}\n\n'+filtersAnchor);
}
if(!brands.includes('["prices","Precios"]')||!brands.includes('<BrandsPricesV2/>'))throw new Error("Brands prices tab not mounted");
fs.writeFileSync(brandsPath,brands);

// 4) Category product sample is no longer artificially tiny.
const categoryLib="src/lib/clickhouse-category-intelligence.ts";
let lib=fs.readFileSync(categoryLib,"utf8");
lib=lib.replace('    LIMIT 80\n  `, params, 8_000);','    LIMIT 300\n  `, params, 8_000);');
fs.writeFileSync(categoryLib,lib);

console.log("Requested platform fixes applied: evolution/products/gaps/alerts/nav/category mix/Brands prices");
