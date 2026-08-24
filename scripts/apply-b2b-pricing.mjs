import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
let source = fs.readFileSync(appPath, "utf8");

const brandImport = 'import BrandsVertical from "./BrandsVertical";';
if (!source.includes('import B2BPricing from "./B2BPricing";')) {
  if (source.includes(brandImport)) source = source.replace(brandImport, `${brandImport}\nimport B2BPricing from "./B2BPricing";`);
  else {
    const styleImport = 'import styles from "./UnifiedPlatformApp.module.css";';
    if (!source.includes(styleImport)) throw new Error("B2B pricing: import anchor missing");
    source = source.replace(styleImport, `${styleImport}\nimport B2BPricing from "./B2BPricing";`);
  }
}

const viewMatch = source.match(/type View = ([^;]+);/);
if (!viewMatch) throw new Error("B2B pricing: View type missing");
if (!viewMatch[0].includes('"pricing-b2b"')) source = source.replace(viewMatch[0], viewMatch[0].replace(";", ' | "pricing-b2b";'));

if (!source.includes('label: "Pricing B2B"')) {
  const brandsGroup = `  { label: "Brands", items: [`;
  const dataGroup = `  { label: "Datos y operación", items: [`;
  if (source.includes(brandsGroup)) {
    const brandsEnd = `  ] },\n${dataGroup}`;
    if (!source.includes(brandsEnd)) throw new Error("B2B pricing: Brands group end anchor missing");
    source = source.replace(brandsEnd, `  ] },\n  { label: "Pricing B2B", items: [\n    { view: "pricing-b2b", label: "Courier & Logistics", icon: "◫" },\n  ] },\n${dataGroup}`);
  } else if (source.includes(dataGroup)) {
    source = source.replace(dataGroup, `  { label: "Pricing B2B", items: [\n    { view: "pricing-b2b", label: "Courier & Logistics", icon: "◫" },\n  ] },\n${dataGroup}`);
  } else throw new Error("B2B pricing: menu anchor missing");
}

const copyAnchor = 'const COPY: Record<View, { title: string; description: string }> = {\n';
if (!source.includes('"pricing-b2b": { title: "Pricing B2B"')) {
  if (!source.includes(copyAnchor)) throw new Error("B2B pricing: COPY anchor missing");
  source = source.replace(copyAnchor, `${copyAnchor}  "pricing-b2b": { title: "Pricing B2B", description: "Compara precios y montos B2B observados en compras públicas por categoría, proveedor y comprador." },\n`);
}

source = source.replace(
  /const LAZY_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => values.includes('"pricing-b2b"') ? full : `const LAZY_VISIBLE_VIEWS = new Set<View>([${values},"pricing-b2b"]);`,
);
source = source.replace(
  /const DARK_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => values.includes('"pricing-b2b"') ? full : `const DARK_VISIBLE_VIEWS = new Set<View>([${values},"pricing-b2b"]);`,
);

if (!source.includes('view === "pricing-b2b" ? <B2BPricing/>')) {
  const brandsRenderer = 'view === "brands" ? <BrandsVertical/> : <>';
  if (source.includes(brandsRenderer)) {
    source = source.replace(brandsRenderer, 'view === "brands" ? <BrandsVertical/> : view === "pricing-b2b" ? <B2BPricing/> : <>');
  } else {
    const automotiveRenderer = 'view === "automotive" ? <AutomotiveIntelligence/> : <>';
    if (!source.includes(automotiveRenderer)) throw new Error("B2B pricing: renderer anchor missing");
    source = source.replace(automotiveRenderer, 'view === "automotive" ? <AutomotiveIntelligence/> : view === "pricing-b2b" ? <B2BPricing/> : <>');
  }
}

fs.writeFileSync(appPath, source);
console.log("Pricing B2B vertical applied");
