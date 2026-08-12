import { readFileSync } from "node:fs";

const app = readFileSync("src/app/UnifiedPlatformApp.tsx", "utf8");
const pricing = readFileSync("src/app/landing/precios/page.tsx", "utf8");
const landing = readFileSync("src/app/landing/page.tsx", "utf8");
const category = readFileSync("src/app/CategoryIntelligence.tsx", "utf8");
const categoryData = readFileSync("src/lib/clickhouse-category-intelligence.ts", "utf8");
const downloads = readFileSync("src/app/ClickHouseDownloads.tsx", "utf8");
const exportRoute = readFileSync("src/app/api/clickhouse-export/route.ts", "utf8");
const insight = readFileSync("src/app/ClickHouseInsightView.tsx", "utf8");
const insightData = readFileSync("src/lib/clickhouse-insights.ts", "utf8");

const requiredApp = [
  ['Category Intelligence import', 'import CategoryIntelligence from "./CategoryIntelligence";'],
  ['Category Intelligence renderer', 'if (view === "category-intelligence") return <CategoryIntelligence'],
  ['Market analysis group', 'label: "Análisis de mercado"'],
  ['Category Intelligence nav', 'label: "Análisis de categorías"'],
  ['Price evolution nav', 'label: "Evolución de precios"'],
  ['Retailer benchmark nav', 'label: "Benchmark retailers"'],
  ['Price gaps nav', 'label: "Brechas de precio"'],
  ['Data status nav', 'label: "Estado de datos"'],
  ['ClickHouse landing import', 'import ClickHouseLanding from "./ClickHouseLanding";'],
  ['ClickHouse insight import', 'import ClickHouseInsightView, { type ClickHouseInsightMode } from "./ClickHouseInsightView";'],
  ['ClickHouse insight renderer', 'isClickHouseInsightView(view) ? <ClickHouseInsightView mode={view}/>'],
  ['Lazy visible view guard', 'if (LAZY_VISIBLE_VIEWS.has(view)) return;'],
  ['ClickHouse downloads import', 'import ClickHouseDownloads from "./ClickHouseDownloads";'],
  ['ClickHouse downloads renderer', 'if (view === "downloads") return <ClickHouseDownloads'],
  ['Account menu import', 'import AccountMenu from "./AccountMenu";'],
  ['Persistent alert center import', 'import CustomerAlerts from "./CustomerAlerts";'],
  ['Commercial experience import', 'import { ActivationGuide, CommercialBanner, minimumPlanForView, requiredModuleForView, type CommercialAccountPayload } from "./CommercialExperience";'],
  ['Plan entitlement resolver', 'const required = requiredModuleForView(next);'],
  ['Pharmacy coverage endpoint', '/api/pharmacy-coverage?live='],
];

const forbiddenApp = [
  'AI Price Optimizer',
  'AI Price Map',
  'Competitive AI',
  'Basket Simulator',
  'BrandIntelligenceChat',
  'label: "Pricing Intelligence"',
  'label: "Promociones"',
  'view === "price-map"',
  'view: "price-map"',
  'view === "promotions"',
  'view: "promotions"',
  'view === "brand-ai"',
  'view: "brand-ai"',
  'view === "optimizer"',
  'view === "competitive"',
  'view === "basket"',
  'view === "price-image"',
  'view === "price-matching"',
  'view === "assortment"',
  'view === "movements"',
  'view === "products"',
  'view === "categories"',
  'view === "retailers"',
  'import AIPriceMap',
];

const failures = [];
for (const [label, marker] of requiredApp) if (!app.includes(marker)) failures.push(`Falta: ${label}`);
for (const marker of forbiddenApp) if (app.includes(marker)) failures.push(`Referencia legacy activa: ${marker}`);

if (!category.includes('100% ClickHouse')) failures.push('Category Intelligence no declara fuente ClickHouse');
if (!category.includes('LineChart') || !category.includes('BrandDonut') || !category.includes('Heatmap')) failures.push('Category Intelligence no incluye el set visual esperado');
if (category.includes('label="En promoción"')) failures.push('Category Intelligence todavía muestra el KPI % de promociones');
if (!categoryData.includes('source: "clickhouse" as const')) failures.push('Category Intelligence no fija ClickHouse como fuente analítica');
if (categoryData.toLowerCase().includes('supabase')) failures.push('Category Intelligence contiene dependencia analítica a Supabase');

if (!insight.includes('Marca') || !insight.includes('Producto') || !insight.includes('Período')) failures.push('Las vistas ClickHouse no comparten filtros Marca / Producto / Período');
if (!insight.includes('/api/clickhouse-insight?')) failures.push('Las vistas lazy no consultan el endpoint ClickHouse dedicado');
if (!insightData.includes('clickHouseInsight') || insightData.toLowerCase().includes('supabase')) failures.push('La analítica lazy no está aislada en ClickHouse');

if (!downloads.includes('/api/clickhouse-export?mode=meta')) failures.push('Descargas no consulta metadata de ClickHouse');
if (!downloads.includes('Descargar CSV para Excel')) failures.push('Descargas no ofrece formato amigable para Excel');
if (!exportRoute.includes('FORMAT CSVWithNames')) failures.push('Export route no genera CSV desde ClickHouse');
if (!exportRoute.includes('excelFriendlyStream')) failures.push('Export route no prepara el CSV para Excel');
if (exportRoute.toLowerCase().includes('enterprise_request_report') || exportRoute.toLowerCase().includes('enterprise-data-export-worker')) failures.push('Export route todavía depende del worker legacy de Supabase');

if (pricing.includes('Competitive AI')) failures.push('Pricing todavía publica Competitive AI');
if (pricing.includes('AI Price Optimizer')) failures.push('Pricing todavía publica AI Price Optimizer');
if (!pricing.includes('Los límites de usuarios, retailers, módulos y exportaciones se aplican')) failures.push('Pricing no transparenta enforcement de plan');
if (!landing.includes('/landing/demo')) failures.push('Landing no enlaza a demo pública');
if (!landing.includes('/landing/cobertura')) failures.push('Landing no enlaza cobertura pública');

if (failures.length) {
  console.error("Prebuild integrity FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Prebuild integrity OK: lazy ClickHouse navigation, category analytics, downloads and permissions validated.");
