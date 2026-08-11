import { readFileSync } from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const app = readFileSync(appPath, "utf8");
const map = readFileSync("src/app/AIPriceMap.tsx", "utf8");
const pricing = readFileSync("src/app/landing/precios/page.tsx", "utf8");
const landing = readFileSync("src/app/landing/page.tsx", "utf8");

const requiredApp = [
  ['AI Price Map import', 'import AIPriceMap from "./AIPriceMap";'],
  ['AI Price Map renderer', 'if (view === "price-map") return <AIPriceMap filters={filters}/>;'],
  ['Brand Intelligence import', 'import BrandIntelligenceChat from "./BrandIntelligenceChat";'],
  ['Brand Intelligence renderer', 'if (view === "brand-ai") return <BrandIntelligenceChat filters={filters}/>;'],
  ['Account menu import', 'import AccountMenu from "./AccountMenu";'],
  ['Account menu renderer', '<AccountMenu skuCount={number(summary?.total_products)} stockCoverage={stockCoverage}/>'],
  ['Persistent alert center import', 'import CustomerAlerts from "./CustomerAlerts";'],
  ['Persistent alert center renderer', 'if (view === "alerts") return <CustomerAlerts/>;'],
  ['Commercial experience import', 'import { ActivationGuide, CommercialBanner, minimumPlanForView, requiredModuleForView, type CommercialAccountPayload } from "./CommercialExperience";'],
  ['Trial/plan banner', '<CommercialBanner account={commercialAccount}/>'],
  ['Activation guide', '<ActivationGuide currentView={view} onNavigate={navigate} account={commercialAccount}/>'],
  ['Plan entitlement resolver', 'const required = requiredModuleForView(next);'],
  ['Minimum plan label', 'const minimumPlan = minimumPlanForView(item.view);'],
  ['Export limit gate', 'exportLimitReached'],
  ['Pharmacy coverage state', 'const [pharmacyCoverage, setPharmacyCoverage]'],
  ['Pharmacy coverage endpoint', '/api/pharmacy-coverage?live='],
  ['Pharmacy coverage UI', 'Cobertura de catálogo · Farmacias'],
  ['Parallel pharmacy run indicator', 'farmacias corriendo en paralelo'],
  ['Scoped promotion loading', 'if (view !== "promotions") return;'],
];

const forbiddenApp = [
  'AI Price Optimizer',
  'Competitive AI',
  'Basket Simulator',
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
  'view: "price-image"',
  'view: "price-matching"',
  'view: "assortment"',
  'view: "movements"',
  'view: "products"',
  'view: "categories"',
  'view: "retailers"',
  '/api/matches?',
  '/api/contextual-pricing-trend',
  '/api/daily-pricing-trend',
  'defaultChecked/></label><label><span><strong>Mostrar datos en vivo',
  'if (view === "alerts") return <section className={styles.workspace}><div className={styles.alertGrid}>',
  '<small className={styles.planLock}>Business</small>',
];

const failures = [];
for (const [label, marker] of requiredApp) {
  if (!app.includes(marker)) failures.push(`Falta: ${label}`);
}
for (const marker of forbiddenApp) {
  if (app.includes(marker)) failures.push(`Referencia legacy activa: ${marker}`);
}

if (!map.includes('Detalle y trazabilidad del análisis')) failures.push('AI Price Map no muestra trazabilidad de fuentes');
if (!map.includes('observedDate(p.lastObservedAt)')) failures.push('AI Price Map no muestra fecha del dato utilizado');
if (!map.includes('p.sampleProducts?.slice(0,2)')) failures.push('AI Price Map no muestra muestra de productos analizados');

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

console.log("Prebuild integrity OK: IA, trazabilidad, permisos por plan, navegación, cargas por vista y cobertura de farmacias validados.");
