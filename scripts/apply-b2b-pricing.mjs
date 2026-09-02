import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const commercialPath = "src/app/CommercialExperience.tsx";
const pricingPath = "src/app/B2BPricing.tsx";
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
  source = source.replace(copyAnchor, `${copyAnchor}  "pricing-b2b": { title: "Pricing B2B", description: "Compara precios B2B normalizados por ruta, peso y distancia junto al contexto de compras públicas." },\n`);
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

let commercial = fs.readFileSync(commercialPath, "utf8");
if (!commercial.includes('if (view === "pricing-b2b") return "Enterprise";')) {
  const planAnchor = '  if (view === "scraping") return "Enterprise";';
  if (!commercial.includes(planAnchor)) throw new Error("B2B pricing: commercial plan anchor missing");
  commercial = commercial.replace(planAnchor, `${planAnchor}\n  if (view === "pricing-b2b") return "Enterprise";`);
  fs.writeFileSync(commercialPath, commercial);
}

let pricing = fs.readFileSync(pricingPath, "utf8");
if (pricing.includes("COURIER_SEGMENTED_ACCORDION_V1")) {
  console.log("Segmented Courier & Logistics UI detected; legacy pricing mutations skipped");
  process.exit(0);
}
pricing = pricing.replace(
  /const WEIGHT_BANDS = \[[^\n]+\];/,
  'const WEIGHT_BANDS = ["0–0,5 kg", "0,5–1,5 kg", "1,5–3 kg", "3–6 kg", "6–10 kg", "10–15 kg", "15–20 kg", "20+ kg"];',
);
pricing = pricing.replace(
  /const refresh = async \(\) => \{[\s\S]*?\n  \};\n\n  const providers/,
  `const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const marketResponse = await fetch("/api/b2b-pricing/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: 2, maxPages: 6 }),
      });
      const marketResult = await marketResponse.json() as { matched?: number; ingested?: number; error?: string };
      if (!marketResponse.ok) throw new Error(marketResult.error || "No fue posible actualizar Mercado Público");

      const ratesResponse = await fetch("/api/b2b-pricing/public-rates/refresh", { method: "POST" });
      const ratesResult = await ratesResponse.json() as { ingested?: number; rows?: number; warnings?: string[]; error?: string };
      if (!ratesResponse.ok) throw new Error(ratesResult.error || "No fue posible actualizar tarifarios públicos");

      const warnings = Array.isArray(ratesResult.warnings) && ratesResult.warnings.length
        ? \` · \${ratesResult.warnings.length} advertencia(s) de fuente\`
        : "";
      setNotice(\`Fuentes actualizadas: \${nf.format(Number(marketResult.matched || 0))} observaciones públicas · \${nf.format(Number(ratesResult.ingested || ratesResult.rows || 0))} tarifas normalizadas\${warnings}.\`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error actualizando fuentes B2B");
    } finally { setRefreshing(false); }
  };

  const providers`,
);
pricing = pricing.replace(
  "cada fila pertenece a un perfil estándar (servicio + banda de peso + banda de distancia)",
  "cada fila pertenece a un perfil homogéneo (servicio + ruta exacta cuando existe + peso de referencia)",
);
fs.writeFileSync(pricingPath, pricing);

console.log("Pricing B2B vertical applied");
