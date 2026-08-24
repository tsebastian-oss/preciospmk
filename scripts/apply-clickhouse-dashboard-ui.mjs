import fs from "node:fs";

const componentPath = "src/app/UnifiedPlatformApp.tsx";
const cssPath = "src/app/UnifiedPlatformApp.module.css";

let source = fs.readFileSync(componentPath, "utf8");

const styleImport = 'import styles from "./UnifiedPlatformApp.module.css";';
if (!source.includes(styleImport)) throw new Error("UnifiedPlatformApp styles import not found");
if (!source.includes('import ClickHouseOverview from "./ClickHouseOverview";')) {
  source = source.replace(styleImport, `${styleImport}\nimport ClickHouseOverview from "./ClickHouseOverview";`);
}

const appAnchor = '  return <div className={styles.app}>';
if (source.includes(appAnchor)) {
  source = source.replace(appAnchor, '  return <div className={`${styles.app} ${view === "overview" ? styles.clickHouseMode : ""}`}>');
} else if (!source.includes('styles.clickHouseMode')) {
  throw new Error("UnifiedPlatformApp root anchor not found");
}

const mainAnchor = '    <main className={styles.main}>';
if (source.includes(mainAnchor)) {
  source = source.replace(
    mainAnchor,
    '    <main className={`${styles.main} ${view === "overview" ? styles.clickHouseMain : ""}`}>\n      {view === "overview" ? <ClickHouseOverview onNavigate={(target) => navigate(target as View)}/> : <>',
  );
} else if (!source.includes('view === "overview" ? <ClickHouseOverview')) {
  throw new Error("UnifiedPlatformApp main anchor not found");
}

const closingAnchor = '\n    </main>\n  </div>;';
if (!source.includes('view === "overview" ? <ClickHouseOverview')) throw new Error("ClickHouse dashboard conditional was not installed");
if (!source.includes('\n      </>}\n    </main>\n  </div>;')) {
  const closingIndex = source.lastIndexOf(closingAnchor);
  if (closingIndex < 0) throw new Error("UnifiedPlatformApp closing anchor not found");
  source = source.slice(0, closingIndex) + '\n      </>}' + source.slice(closingIndex);
}

fs.writeFileSync(componentPath, source);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* clickhouse-price-intelligence-dashboard-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.clickHouseMode{--canvas:#090d12;background:#090d12}.clickHouseMode .sidebar{background:linear-gradient(180deg,#0b1016 0%,#0c1219 72%,#0a0f15 100%);border-right:1px solid #202731;color:#d3d8df}.clickHouseMode .brand small{color:#727d8d}.clickHouseMode .logo i{background:linear-gradient(180deg,#f7d315,#c89b00)}.clickHouseMode .navGroup h3{color:#596474}.clickHouseMode .navGroup button{color:#9aa4b2}.clickHouseMode .navGroup button:hover{background:#141a21;color:#fff}.clickHouseMode .navGroup button.activeNav{position:relative;border-color:#2c333c;background:#171d24;color:#f4f5f6;box-shadow:none}.clickHouseMode .navGroup button.activeNav:before{content:\"\";position:absolute;left:-12px;top:6px;bottom:6px;width:3px;border-radius:3px;background:#f5c400}.clickHouseMode .navGroup button.activeNav>i{background:rgba(245,196,0,.12);color:#f5c400}.clickHouseMode .account{border-color:#242c35;background:#10161c}.clickHouseMode .account>div:first-child>span{background:#f5c400;color:#15130a}.clickHouseMode .account>div:nth-of-type(2) i{background:#f5c400}.clickHouseMode .account>strong em{background:#62d47b}.clickHouseMain{padding:0!important;background:#090d12!important;min-height:100vh}.clickHouseMain~*{background:#090d12}@media(max-width:1020px){.clickHouseMain{padding:0!important}}\n`;
  fs.writeFileSync(cssPath, css);
}

const overviewPath = "src/app/ClickHouseOverview.tsx";
if (fs.existsSync(overviewPath)) {
  let overview = fs.readFileSync(overviewPath, "utf8");
  overview = overview
    .replace(
      "Pricing, promociones y movimientos competitivos calculados en ClickHouse sobre un dataset demo congelado.",
      "Pricing, promociones y movimientos competitivos calculados directamente en ClickHouse sobre el histórico sincronizado.",
    )
    .replace("<small>DATASET DEMO</small>", "<small>CLICKHOUSE LIVE</small>")
    .replace("CLICKHOUSE DEMO", "CLICKHOUSE LIVE")
    .replace(
      "Los KPI, gráficos, rankings y alertas se calculan en ClickHouse sobre el dataset demo congelado. Supabase continúa capturando la data nueva por separado hasta reactivar la sincronización.",
      "Los KPI, gráficos, rankings y alertas se calculan directamente en ClickHouse sobre el histórico sincronizado. La actualización se ejecuta bajo demanda para evitar consumo innecesario de compute.",
    )
    .replace("Datos hasta {datasetLabel}", "Último dato {datasetLabel}");
  fs.writeFileSync(overviewPath, overview);
}

const dailyTrendPath = "src/app/DailyPricingChartPortal.tsx";
if (fs.existsSync(dailyTrendPath)) {
  let dailyTrend = fs.readFileSync(dailyTrendPath, "utf8");
  dailyTrend = dailyTrend
    .replace("DATASET DEMO", "LIVE DATA")
    .replace("HISTÓRICO CONGELADO", "ACTUALIZACIÓN BAJO DEMANDA")
    .replace(
      "Agrega o quita líneas para comparar categorías y marcas sobre el histórico congelado de la demo. La vista se recalcula solo cuando cambias filtros o período.",
      "Agrega o quita líneas para comparar categorías y marcas sobre el histórico sincronizado. La vista se recalcula cuando cambias filtros o período, sin polling automático.",
    )
    .replace('syncing ? "Actualizando vista" : "Sin actualización automática"', 'syncing ? "Actualizando vista" : "Actualización bajo demanda"');
  fs.writeFileSync(dailyTrendPath, dailyTrend);
}

console.log("ClickHouse Price Intelligence dashboard wired into Overview");
