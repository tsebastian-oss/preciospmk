import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const commercialPath = "src/app/CommercialExperience.tsx";
let source = fs.readFileSync(appPath, "utf8");

const automotiveImport = 'import AutomotiveIntelligence from "./AutomotiveIntelligence";';
if (!source.includes('import BrandsVertical from "./BrandsVertical";')) {
  if (!source.includes(automotiveImport)) throw new Error("Brands vertical: automotive import anchor missing");
  source = source.replace(automotiveImport, `${automotiveImport}\nimport BrandsVertical from "./BrandsVertical";`);
}

const viewMatch = source.match(/type View = ([^;]+);/);
if (!viewMatch) throw new Error("Brands vertical: View type missing");
if (!viewMatch[0].includes('"brands"')) source = source.replace(viewMatch[0], viewMatch[0].replace(";", ' | "brands";'));

if (!source.includes('label: "Brands"')) {
  const dataGroup = `  { label: "Datos y operación", items: [`;
  if (!source.includes(dataGroup)) throw new Error("Brands vertical: menu anchor missing");
  source = source.replace(dataGroup, `  { label: "Brands", items: [\n    { view: "brands", label: "Marcas", icon: "◆" },\n  ] },\n${dataGroup}`);
}

const copyAnchor = 'const COPY: Record<View, { title: string; description: string }> = {\n';
if (!source.includes('brands: { title: "Brand & Retail Intelligence"')) {
  if (!source.includes(copyAnchor)) throw new Error("Brands vertical: COPY anchor missing");
  source = source.replace(copyAnchor, `${copyAnchor}  brands: { title: "Brand & Retail Intelligence", description: "Descubre dónde se vende una marca y monitorea catálogo, precios, sellers y presencia digital." },\n`);
}

source = source.replace(
  /const LAZY_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => values.includes('"brands"') ? full : `const LAZY_VISIBLE_VIEWS = new Set<View>([${values},"brands"]);`,
);
source = source.replace(
  /const DARK_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => values.includes('"brands"') ? full : `const DARK_VISIBLE_VIEWS = new Set<View>([${values},"brands"]);`,
);

const rendererOld = 'view === "automotive" ? <AutomotiveIntelligence/> : <>';
const rendererNew = 'view === "automotive" ? <AutomotiveIntelligence/> : view === "brands" ? <BrandsVertical/> : <>';
if (source.includes(rendererOld)) source = source.replace(rendererOld, rendererNew);
else if (!source.includes('view === "brands" ? <BrandsVertical/>')) throw new Error("Brands vertical: renderer anchor missing");

if (!source.includes('import BrandsVertical from "./BrandsVertical";')) throw new Error("Brands vertical import missing");
if (!source.includes('label: "Brands"')) throw new Error("Brands nav missing");
if (!source.includes('view === "brands" ? <BrandsVertical/>')) throw new Error("Brands renderer missing");
fs.writeFileSync(appPath, source);

let commercial = fs.readFileSync(commercialPath, "utf8");
if (!commercial.includes('if (view === "brands") return "Enterprise";')) {
  const anchor = '  if (view === "automotive") return "Enterprise";';
  if (!commercial.includes(anchor)) throw new Error("Brands vertical: minimum plan anchor missing");
  commercial = commercial.replace(anchor, `${anchor}\n  if (view === "brands") return "Enterprise";`);
  fs.writeFileSync(commercialPath, commercial);
}

console.log("Brands vertical applied");
