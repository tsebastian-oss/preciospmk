import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const commercialPath = "src/app/CommercialExperience.tsx";
let source = fs.readFileSync(appPath, "utf8");

const insightImport = 'import ClickHouseInsightView, { type ClickHouseInsightMode } from "./ClickHouseInsightView";';
if (!source.includes('import AutomotiveIntelligence from "./AutomotiveIntelligence";')) {
  if (!source.includes(insightImport)) throw new Error("Automotive vertical: ClickHouse insight import anchor missing");
  source = source.replace(insightImport, `${insightImport}\nimport AutomotiveIntelligence from "./AutomotiveIntelligence";`);
}

const viewMatch = source.match(/type View = ([^;]+);/);
if (!viewMatch) throw new Error("Automotive vertical: View type missing");
if (!viewMatch[0].includes('"automotive"')) {
  source = source.replace(viewMatch[0], viewMatch[0].replace(";", ' | "automotive";'));
}

if (!source.includes('label: "Automotriz"')) {
  const dataGroup = `  { label: "Datos y operación", items: [`;
  if (!source.includes(dataGroup)) throw new Error("Automotive vertical: menu data group anchor missing");
  source = source.replace(dataGroup, `  { label: "Automotriz", items: [\n    { view: "automotive", label: "Mercado automotriz", icon: "◇" },\n  ] },\n${dataGroup}`);
}

const copyAnchor = 'const COPY: Record<View, { title: string; description: string }> = {\n';
if (!source.includes('automotive: { title: "Mercado automotriz"')) {
  if (!source.includes(copyAnchor)) throw new Error("Automotive vertical: COPY anchor missing");
  source = source.replace(copyAnchor, `${copyAnchor}  automotive: { title: "Mercado automotriz", description: "Marcas, modelos, versiones, bonos y precios desde concesionarios chilenos." },\n`);
}

source = source.replace(
  /const LAZY_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => values.includes('"automotive"') ? full : `const LAZY_VISIBLE_VIEWS = new Set<View>([${values},"automotive"]);`,
);
source = source.replace(
  /const DARK_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => values.includes('"automotive"') ? full : `const DARK_VISIBLE_VIEWS = new Set<View>([${values},"automotive"]);`,
);

const rendererOld = 'view === "category-intelligence" ? <CategoryIntelligence/> : <>';
const rendererNew = 'view === "category-intelligence" ? <CategoryIntelligence/> : view === "automotive" ? <AutomotiveIntelligence/> : <>';
if (source.includes(rendererOld)) source = source.replace(rendererOld, rendererNew);
else if (!source.includes('view === "automotive" ? <AutomotiveIntelligence/>')) throw new Error("Automotive vertical: renderer anchor missing");

if (!source.includes('import AutomotiveIntelligence from "./AutomotiveIntelligence";')) throw new Error("Automotive vertical import missing");
if (!source.includes('label: "Automotriz"')) throw new Error("Automotive nav missing");
if (!source.includes('view === "automotive" ? <AutomotiveIntelligence/>')) throw new Error("Automotive renderer missing");
fs.writeFileSync(appPath, source);

let commercial = fs.readFileSync(commercialPath, "utf8");
if (!commercial.includes('if (view === "automotive") return "Enterprise";')) {
  const anchor = '  if (view === "scraping") return "Enterprise";';
  if (!commercial.includes(anchor)) throw new Error("Automotive vertical: minimum plan anchor missing");
  commercial = commercial.replace(anchor, `${anchor}\n  if (view === "automotive") return "Enterprise";`);
  fs.writeFileSync(commercialPath, commercial);
}

console.log("Automotive dealer-first vertical applied");
