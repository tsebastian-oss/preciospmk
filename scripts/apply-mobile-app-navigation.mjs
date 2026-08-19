import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const cssPath = "src/app/UnifiedPlatformApp.module.css";

let source = fs.readFileSync(appPath, "utf8");
const marker = "globalMobileMenuButton";

if (!source.includes(marker)) {
  const asideAnchor = '    <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`}>\n';
  if (!source.includes(asideAnchor)) throw new Error("Mobile app navigation: sidebar anchor missing");

  const controls = `    <button
      type="button"
      className={styles.globalMobileMenuButton}
      aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
      aria-expanded={mobileOpen}
      onClick={() => setMobileOpen((current) => !current)}
    ><span/><span/><span/></button>
    {mobileOpen && <button type="button" className={styles.mobileMenuBackdrop} aria-label="Cerrar menú" onClick={() => setMobileOpen(false)}/>}
`;
  source = source.replace(asideAnchor, controls + asideAnchor);
  fs.writeFileSync(appPath, source);
}

let css = fs.readFileSync(cssPath, "utf8");
const cssMarker = "/* global-mobile-app-navigation-v1 */";
if (!css.includes(cssMarker)) {
  css += `\n${cssMarker}\n.globalMobileMenuButton,.mobileMenuBackdrop{display:none}@media(max-width:760px){.globalMobileMenuButton{position:fixed;top:max(12px,env(safe-area-inset-top));right:12px;z-index:100;display:grid!important;place-content:center;gap:4px;width:46px;height:46px;padding:0;border:1px solid rgba(255,255,255,.18);border-radius:13px;background:rgba(10,15,21,.94);box-shadow:0 10px 30px rgba(0,0,0,.32);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);touch-action:manipulation}.globalMobileMenuButton span{display:block;width:20px;height:2px;border-radius:999px;background:#f5c400;transition:transform .18s ease,opacity .18s ease}.globalMobileMenuButton[aria-expanded=\"true\"] span:nth-child(1){transform:translateY(6px) rotate(45deg)}.globalMobileMenuButton[aria-expanded=\"true\"] span:nth-child(2){opacity:0}.globalMobileMenuButton[aria-expanded=\"true\"] span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}.mobileMenuBackdrop{position:fixed;inset:0;z-index:60;display:block!important;border:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}.sidebar{z-index:70!important;box-shadow:20px 0 50px rgba(0,0,0,.38)}.sidebar.mobileOpen{left:0!important}.menuButton{display:none!important}}\n`;
  fs.writeFileSync(cssPath, css);
}

if (!fs.readFileSync(appPath, "utf8").includes(marker)) throw new Error("Mobile app navigation: trigger missing");
if (!fs.readFileSync(cssPath, "utf8").includes(cssMarker)) throw new Error("Mobile app navigation: styles missing");

console.log("Global mobile app navigation applied");
