import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
let app = fs.readFileSync(appPath, "utf8");
let changed = false;

function replace(oldValue, newValue, label, required = true) {
  if (app.includes(newValue)) return;
  if (!app.includes(oldValue)) {
    if (required) throw new Error(`Navigation/download patch anchor missing: ${label}`);
    return;
  }
  app = app.replace(oldValue, newValue);
  changed = true;
}

// Keep the same dark ClickHouse shell for Overview, Category Intelligence and Downloads.
replace(
  '`${styles.app} ${view === "overview" ? styles.clickHouseMode : ""}`',
  '`${styles.app} ${view === "overview" || view === "category-intelligence" || view === "downloads" ? styles.clickHouseMode : ""}`',
  "dark shell",
  false,
);
replace(
  '`${styles.main} ${view === "overview" ? styles.clickHouseMain : ""}`',
  '`${styles.main} ${view === "overview" || view === "category-intelligence" || view === "downloads" ? styles.clickHouseMain : ""}`',
  "dark main",
  false,
);

// Downloads are rendered by the new ClickHouse streaming workspace.
if (!app.includes('import ClickHouseDownloads from "./ClickHouseDownloads";')) {
  const importAnchor = 'import CategoryIntelligence from "./CategoryIntelligence";';
  if (!app.includes(importAnchor)) throw new Error("Category Intelligence import missing before downloads patch");
  app = app.replace(importAnchor, `${importAnchor}\nimport ClickHouseDownloads from "./ClickHouseDownloads";`);
  changed = true;
}

const downloadStart = app.indexOf('    if (view === "downloads")');
const alertsStart = app.indexOf('    if (view === "alerts")', downloadStart);
if (downloadStart >= 0 && alertsStart > downloadStart) {
  app = app.slice(0, downloadStart)
    + '    if (view === "downloads") return <ClickHouseDownloads filters={{ supermarket: filters.supermarket, category: filters.category, brand: filters.brand }}/>;\n\n'
    + app.slice(alertsStart);
  changed = true;
} else if (!app.includes('if (view === "downloads") return <ClickHouseDownloads')) {
  throw new Error("Downloads renderer could not be replaced");
}

// Remove retired navigation modules from the generated app.
app = app.replace(' | "price-map"', '');
app = app.replace(' | "promotions"', '');
app = app.replace(/^import AIPriceMap from "\.\/AIPriceMap";\n/m, '');
app = app.replace(/^\s*"price-map": \{[^\n]*\n/m, '');
app = app.replace(/^\s*promotions: \{[^\n]*\n/m, '');
app = app.replace(/^\s*if \(view === "price-map"\) return <AIPriceMap[^\n]*\n/m, '');
app = app.replace(/^\s*if \(view === "promotions"\) return renderProducts\(true\);\n/m, '');
app = app.replaceAll('if (view !== "promotions") return;', 'return; // global Promotions module retired');

// Category Intelligence is now a first-class menu group, not a child of Pricing Intelligence.
const pricingGroup = /  \{ label: "Pricing Intelligence", items: \[\n[\s\S]*?  \] \},\n/;
if (pricingGroup.test(app)) {
  app = app.replace(pricingGroup, '  { label: "Category Intelligence", items: [\n    { view: "category-intelligence", label: "Análisis de Categorías", icon: "◒" },\n  ] },\n');
  changed = true;
}
const commercialGroup = /  \{ label: "Commercial Intelligence", items: \[\n[\s\S]*?  \] \},\n/;
if (commercialGroup.test(app)) {
  app = app.replace(commercialGroup, '');
  changed = true;
}

// Remove stale navigation actions if an earlier patch left one behind.
app = app.replaceAll('navigate("price-map")', 'navigate("category-intelligence")');
app = app.replaceAll('Abrir AI Price Map', 'Abrir Análisis de Categorías');

const forbidden = [
  'view: "price-map"',
  'view: "promotions"',
  'view === "price-map"',
  'view === "promotions"',
  'import AIPriceMap',
  'label: "Promociones"',
  'label: "Pricing Intelligence"',
];
const leftovers = forbidden.filter((marker) => app.includes(marker));
if (leftovers.length) throw new Error(`Retired navigation still active: ${leftovers.join(", ")}`);
if (!app.includes('label: "Category Intelligence"') || !app.includes('view: "category-intelligence"')) {
  throw new Error("Category Intelligence did not become its own navigation group");
}
if (!app.includes('ClickHouseDownloads')) throw new Error("ClickHouse downloads are not wired");

fs.writeFileSync(appPath, app);
console.log(changed ? "Category navigation, retired modules and ClickHouse downloads applied" : "Category navigation/download patch already applied");
