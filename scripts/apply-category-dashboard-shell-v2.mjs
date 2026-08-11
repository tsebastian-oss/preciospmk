import fs from "node:fs";

const componentPath = "src/app/CategoryIntelligence.tsx";
const cssPath = "src/app/CategoryIntelligence.module.css";
const commercialPath = "src/app/CommercialExperience.tsx";
let component = fs.readFileSync(componentPath, "utf8");

const promoKpi = '        <Kpi label="En promoción" value={`${(k?.promotionPct ?? 0).toFixed(1)}%`} detail={`${integer.format(k?.promotions ?? 0)} SKU`}/>\n';
if (component.includes(promoKpi)) component = component.replace(promoKpi, "");
component = component.replace('CATEGORY INTELLIGENCE · CLICKHOUSE', 'CATEGORY INTELLIGENCE');
component = component.replace('Precios, surtido, promociones y productos en una sola vista analítica.', 'Precios, surtido, marcas, retailers y productos calculados directamente en ClickHouse.');
fs.writeFileSync(componentPath, component);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* category-intelligence-main-dashboard-shell-v2 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.root{--bg:#0a0d12;--panel:#11161d;--line:#252d38;--muted:#8993a3;--text:#f4f6f8;--yellow:#f5c400;min-height:100vh;padding:24px 26px 30px;background:radial-gradient(circle at 78% 0%,rgba(245,196,0,.05),transparent 24%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.hero{align-items:center;margin-bottom:4px;padding:0;border:0;border-radius:0;background:transparent}.hero span{display:block;margin-bottom:5px;color:var(--yellow);font-size:10px;font-weight:900;letter-spacing:.14em}.hero h2{margin:0;font-size:27px;line-height:1.08;letter-spacing:-.03em}.hero p{margin:6px 0 0;color:#8f99a8;font-size:12px}.source{padding:8px 10px;border:1px solid #343014;border-radius:10px;background:#15150e;color:#f5e99d;font-size:9px}.controls{grid-template-columns:minmax(220px,1.5fr) minmax(170px,1fr) 150px auto;margin-bottom:0;padding:12px;border:1px solid #232a34;border-radius:11px;background:#0f141a}.controls label span{color:#858f9e;font-size:9px}.controls select,.controls button{height:39px;border-color:#2b333e;border-radius:8px;background:#151b23;color:#e6eaf0;font-size:11px}.tabs{margin:0;border-color:#232a34;border-radius:9px;background:#0f141a}.tabs button{padding:8px 13px;font-size:9px}.tabs .activeTab{background:#292713;color:var(--yellow)}.kpis{grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.kpi{min-height:113px;padding:15px 14px 12px;border-color:var(--line);border-radius:10px;background:linear-gradient(180deg,#141a22,#10151c)}.kpi>span{color:#9aa3b1;font-size:9px}.kpi strong{margin-top:4px;font-size:24px}.kpi small{margin-top:3px;color:#687383;font-size:9px}.kpiEmphasis{border-color:#3f3816;background:linear-gradient(180deg,#171812,#11150e)}.card{padding:15px;border-color:var(--line);border-radius:10px;background:linear-gradient(180deg,#121820,#0f141b);box-shadow:0 8px 24px rgba(0,0,0,.12)}.cardTitle span{color:#7d8796;font-size:8px}.cardTitle h3{font-size:13px}.cardTitle p{color:#727d8d;font-size:9px}.dashboardGrid{gap:10px}.error,.loading,.empty{border-color:#2b333e;border-radius:9px;background:#0f141a}.productToolbar input,.productToolbar select{background:#151b23;border-color:#2b333e;color:#e6eaf0}@media(max-width:1180px){.kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:900px){.root{padding:18px}.hero{align-items:flex-start}.controls{grid-template-columns:repeat(2,1fr)}.kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.root{padding:14px 11px 22px}.hero{display:grid}.hero h2{font-size:22px}.source{justify-self:start}.controls{grid-template-columns:1fr}.kpis{grid-template-columns:1fr}}\n`;
  fs.writeFileSync(cssPath, css);
}

let commercial = fs.readFileSync(commercialPath, "utf8");
commercial = commercial.replace('  "price-map": "optimizer",\n', '');
commercial = commercial.replace('  promotions: "promotions",\n', '');
commercial = commercial.replace('  if (["category-intelligence", "price-map"].includes(view)) return "Business";', '  if (view === "category-intelligence") return "Business";');
commercial = commercial.replace('  { view: "promotions", title: "Revisa promociones", copy: "Detecta ofertas vigentes dentro de tu alcance." },\n', '');
commercial = commercial.replace('  { view: "price-map", title: "Construye un AI Price Map", copy: "Compara posicionamiento, cobertura y precio relativo." },\n', '');
commercial = commercial.replace('  { view: "downloads", title: "Exporta un análisis", copy: "Lleva los datos a Excel o CSV para tu equipo." },', '  { view: "downloads", title: "Descarga la base", copy: "Exporta el histórico directamente desde ClickHouse en formato compatible con Excel." },');
fs.writeFileSync(commercialPath, commercial);

console.log("Category Intelligence aligned with main ClickHouse dashboard shell and retired commercial shortcuts removed");
