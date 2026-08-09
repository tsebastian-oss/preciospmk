import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const cssPath = "src/app/UnifiedPlatformApp.module.css";

let app = fs.readFileSync(appPath, "utf8");
const oldControls = '<button className={styles.headerControl}><span>▣</span> Últimos {filters.period} días</button><button className={styles.headerControl}><span>▱</span> {filterOptions?.industrySlug || "Todas las industrias"}</button>';
const newControls = '<label className={styles.headerSelect}><span>▣</span><select aria-label="Período global" value={filters.period} onChange={(event) => updateFilter("period", Number(event.target.value))}><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option></select></label><a className={styles.headerControl} href="/onboarding?change=1" title="Cambiar industria"><span>▱</span>{!filterOptions?.industrySlug || filterOptions.industrySlug === "all" ? "Todas las industrias" : filterOptions.industrySlug.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}</a>';

if (app.includes(oldControls)) {
  app = app.replace(oldControls, newControls);
  fs.writeFileSync(appPath, app);
} else if (!app.includes('aria-label="Período global"')) {
  throw new Error("Dashboard header controls pattern not found");
}

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* dashboard-control-fix-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.app select{appearance:none!important;-webkit-appearance:none!important;color-scheme:light;background-color:#fff!important;background-image:linear-gradient(45deg,transparent 50%,#69778d 50%),linear-gradient(135deg,#69778d 50%,transparent 50%)!important;background-position:calc(100% - 17px) 50%,calc(100% - 12px) 50%!important;background-size:5px 5px,5px 5px!important;background-repeat:no-repeat!important;padding-right:34px!important;box-shadow:none!important}.app select:focus{border-color:#2563eb!important;box-shadow:0 0 0 3px rgba(37,99,235,.10)!important}.headerControl{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.headerSelect{height:44px;display:flex;align-items:center;gap:5px;padding:0 7px 0 13px;border:1px solid var(--line);border-radius:11px;background:#fff;color:#536078;white-space:nowrap}.headerSelect>span{font-size:12px}.headerSelect select{height:40px;min-width:148px;border:0!important;outline:0!important;background-color:transparent!important;color:#536078;font-size:12px;font-weight:750;padding-left:2px!important}.filters select{min-height:40px;background-color:#fff!important}.toolbar select,.seriesPicker select{background-color:#fff!important}\n`;
  fs.writeFileSync(cssPath, css);
}
