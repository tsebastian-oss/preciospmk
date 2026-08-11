import fs from "node:fs";

const path = "src/app/UnifiedPlatformApp.tsx";
let app = fs.readFileSync(path, "utf8");
let changed = false;

function replaceOnce(label, oldValue, newValue) {
  if (app.includes(newValue)) return;
  if (!app.includes(oldValue)) throw new Error(`Category Intelligence patch anchor missing: ${label}`);
  app = app.replace(oldValue, newValue);
  changed = true;
}

replaceOnce(
  "component import",
  'import BrandIntelligenceChat from "./BrandIntelligenceChat";',
  'import CategoryIntelligence from "./CategoryIntelligence";',
);

if (app.includes(' | "brand-ai"')) {
  app = app.replace(' | "brand-ai"', ' | "category-intelligence"');
  changed = true;
}

replaceOnce(
  "menu item",
  '{ view: "brand-ai", label: "MGP Intelligence", icon: "✦" },',
  '{ view: "category-intelligence", label: "Análisis de Categorías", icon: "◒" },',
);

replaceOnce(
  "copy",
  '  "brand-ai": { title: "MGP Intelligence", description: "Conversa naturalmente con tus datos diarios de precios, surtido, stock y promociones, potenciado por OpenAI Sol." },',
  '  "category-intelligence": { title: "Análisis de Categorías", description: "Explora visualmente precios, surtido, promociones, retailers y productos de cada categoría usando ClickHouse." },',
);

replaceOnce(
  "renderer",
  '    if (view === "brand-ai") return <BrandIntelligenceChat filters={filters}/>;',
  '    if (view === "category-intelligence") return <CategoryIntelligence filters={{ supermarket: filters.supermarket, period: filters.period }}/>;',
);

app = app.replaceAll('onClick={() => navigate("brand-ai")}', 'onClick={() => navigate("category-intelligence")}');
app = app.replaceAll('Abrir MGP Intelligence', 'Abrir Análisis de Categorías');
app = app.replaceAll('MGP Intelligence', 'Category Intelligence');

if (app.includes('view === "brand-ai"') || app.includes('view: "brand-ai"') || app.includes('BrandIntelligenceChat')) {
  throw new Error("Category Intelligence patch left legacy MGP Intelligence navigation active");
}

fs.writeFileSync(path, app);
console.log(changed ? "Category Intelligence navigation ready" : "Category Intelligence navigation already ready");
