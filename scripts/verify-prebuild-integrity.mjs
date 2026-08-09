import { readFileSync } from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const text = readFileSync(appPath, "utf8");

const required = [
  ['AI Price Map import', 'import AIPriceMap from "./AIPriceMap";'],
  ['AI Price Map renderer', 'if (view === "price-map") return <AIPriceMap filters={filters}/>;'],
  ['Brand Intelligence import', 'import BrandIntelligenceChat from "./BrandIntelligenceChat";'],
  ['Brand Intelligence renderer', 'if (view === "brand-ai") return <BrandIntelligenceChat filters={filters}/>;'],
  ['Account menu import', 'import AccountMenu from "./AccountMenu";'],
  ['Account menu renderer', '<AccountMenu skuCount={number(summary?.total_products)} stockCoverage={stockCoverage}/>'],
  ['Contextual trend endpoint', 'endpoint = "/api/contextual-pricing-trend";'],
];

const forbidden = [
  'AI Price Optimizer',
  'Competitive AI',
  'Basket Simulator',
  'view === "optimizer"',
  'view === "competitive"',
  'view === "basket"',
];

const failures = [];
for (const [label, marker] of required) {
  if (!text.includes(marker)) failures.push(`Falta: ${label}`);
}
for (const marker of forbidden) {
  if (text.includes(marker)) failures.push(`Referencia legacy activa: ${marker}`);
}

if (failures.length) {
  console.error("Prebuild integrity FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Prebuild integrity OK: módulos IA, navegación, cuenta y tendencia contextual validados.");
