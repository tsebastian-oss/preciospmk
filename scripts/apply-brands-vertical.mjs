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
const viewWithBrands = source.match(/type View = ([^;]+);/);
if (viewWithBrands && !viewWithBrands[0].includes('"piwen"')) source = source.replace(viewWithBrands[0], viewWithBrands[0].replace(";", ' | "piwen";'));

if (!source.includes('label: "Brands"')) {
  const dataGroup = `  { label: "Datos y operación", items: [`;
  if (!source.includes(dataGroup)) throw new Error("Brands vertical: menu anchor missing");
  source = source.replace(dataGroup, `  { label: "Brands", items: [\n    { view: "brands", label: "Marcas", icon: "◆" },\n    { view: "piwen", label: "Piwén", icon: "◈" },\n  ] },\n${dataGroup}`);
}

const copyAnchor = 'const COPY: Record<View, { title: string; description: string }> = {\n';
if (!source.includes('piwen: { title: "Piwén Pricing Intelligence"')) {
  if (!source.includes(copyAnchor)) throw new Error("Piwén vertical: COPY anchor missing");
  source = source.replace(copyAnchor, `${copyAnchor}  piwen: { title: "Piwén Pricing Intelligence", description: "Demo dedicada para monitorear paridad de canales, benchmark por kilo, promociones y arquitectura de precios de Piwén." },\n`);
}
if (!source.includes('brands: { title: "Brand & Retail Intelligence"')) {
  if (!source.includes(copyAnchor)) throw new Error("Brands vertical: COPY anchor missing");
  source = source.replace(copyAnchor, `${copyAnchor}  brands: { title: "Brand & Retail Intelligence", description: "Descubre dónde se vende una marca y monitorea catálogo, precios, sellers y presencia digital." },\n`);
}

source = source.replace(
  /const LAZY_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => {
    const next = values.includes('"brands"') ? values : `${values},"brands"`;
    return next.includes('"piwen"') ? `const LAZY_VISIBLE_VIEWS = new Set<View>([${next}]);` : `const LAZY_VISIBLE_VIEWS = new Set<View>([${next},"piwen"]);`;
  },
);
source = source.replace(
  /const DARK_VISIBLE_VIEWS = new Set<View>\(\[([^\]]*)\]\);/,
  (full, values) => {
    const next = values.includes('"brands"') ? values : `${values},"brands"`;
    return next.includes('"piwen"') ? `const DARK_VISIBLE_VIEWS = new Set<View>([${next}]);` : `const DARK_VISIBLE_VIEWS = new Set<View>([${next},"piwen"]);`;
  },
);

const rendererOld = 'view === "automotive" ? <AutomotiveIntelligence/> : <>';
const rendererNew = 'view === "automotive" ? <AutomotiveIntelligence/> : view === "piwen" ? <BrandsVertical initialBrand="piwen"/> : view === "brands" ? <BrandsVertical/> : <>';
if (source.includes(rendererOld)) source = source.replace(rendererOld, rendererNew);
else if (!source.includes('view === "brands" ? <BrandsVertical/>')) throw new Error("Brands vertical: renderer anchor missing");
if (!source.includes('view === "piwen" ? <BrandsVertical initialBrand="piwen"/>')) {
  source = source.replace('view === "brands" ? <BrandsVertical/> : <>', 'view === "piwen" ? <BrandsVertical initialBrand="piwen"/> : view === "brands" ? <BrandsVertical/> : <>');
}

if (!source.includes('import BrandsVertical from "./BrandsVertical";')) throw new Error("Brands vertical import missing");
if (!source.includes('label: "Brands"')) throw new Error("Brands nav missing");
if (!source.includes('view === "brands" ? <BrandsVertical/>')) throw new Error("Brands renderer missing");
if (!source.includes('view === "piwen" ? <BrandsVertical initialBrand="piwen"/>')) throw new Error("Piwén renderer missing");
fs.writeFileSync(appPath, source);

let commercial = fs.readFileSync(commercialPath, "utf8");
if (!commercial.includes('if (view === "brands") return "Enterprise";')) {
  const anchor = '  if (view === "automotive") return "Enterprise";';
  if (!commercial.includes(anchor)) throw new Error("Brands vertical: minimum plan anchor missing");
  commercial = commercial.replace(anchor, `${anchor}\n  if (view === "brands") return "Enterprise";
  if (view === "piwen") return "Enterprise";`);
  fs.writeFileSync(commercialPath, commercial);
}

console.log("Brands vertical applied");
