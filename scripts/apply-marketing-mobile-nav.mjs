import fs from "node:fs";

const shellPath = "src/app/landing/MarketingShell.tsx";
const cssPath = "src/app/landing/marketing.module.css";
let shell = fs.readFileSync(shellPath, "utf8");

const importAnchor = 'import styles from "./marketing.module.css";';
const mobileImport = 'import MarketingMobileNav from "./MarketingMobileNav";';
if (!shell.includes(mobileImport)) {
  if (!shell.includes(importAnchor)) throw new Error("Marketing styles import not found");
  shell = shell.replace(importAnchor, `${importAnchor}\n${mobileImport}`);
}

const actions = '<div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: 4, whiteSpace: "nowrap" }}>';
if (shell.includes(actions) && !shell.includes('className={styles.desktopHeaderActions}')) {
  shell = shell.replace(actions, '<div className={styles.desktopHeaderActions}>');
}
const headerEnd = '          <Link className={styles.headerCta} href="/landing/contacto#demo">Solicitar demo</Link>\n        </div>\n      </div>';
if (shell.includes(headerEnd) && !shell.includes('<MarketingMobileNav />')) {
  shell = shell.replace(headerEnd, '          <Link className={styles.headerCta} href="/landing/contacto#demo">Solicitar demo</Link>\n        </div>\n        <MarketingMobileNav />\n      </div>');
}
if (!shell.includes('<MarketingMobileNav />')) throw new Error("Mobile nav was not inserted in marketing header");
fs.writeFileSync(shellPath, shell);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* marketing-mobile-nav-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.desktopHeaderActions{display:flex;align-items:center;gap:9px;margin-left:4px;white-space:nowrap}.mobileNavRoot{display:none;position:relative;margin-left:auto}.mobileMenuButton{width:42px;height:42px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);display:grid;place-content:center;gap:4px;cursor:pointer}.mobileMenuButton span{display:block;width:19px;height:2px;border-radius:999px;background:#fff}.mobileMenu{position:absolute;right:0;top:50px;width:min(330px,calc(100vw - 32px));background:#071c38;border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.38);padding:10px;z-index:120}.mobileMenu nav{display:grid}.mobileMenu nav a{display:flex;align-items:center;justify-content:space-between;padding:13px 12px;border-radius:10px;color:#eff6ff;font-size:13px;font-weight:800}.mobileMenu nav a:hover{background:rgba(255,255,255,.07)}.mobileMenu nav a span{font-size:18px;color:#77a9e5}.mobileMenuActions{border-top:1px solid rgba(255,255,255,.1);margin-top:6px;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.mobileMenuActions a{display:grid;place-items:center;padding:11px 9px;border-radius:9px;color:#fff;font-size:11px;font-weight:850;background:rgba(255,255,255,.08)}.mobileMenuActions a:nth-child(2){background:#1478ee}.mobileMenuActions a:last-child{grid-column:1/-1;background:#0ba455}@media(max-width:1100px){.desktopHeaderActions{display:none!important}.mobileNavRoot{display:block}.headerInner{gap:14px}}@media(max-width:720px){.mobileMenu{position:fixed;top:70px;right:16px}.logo{min-width:0}}\n`;
  fs.writeFileSync(cssPath, css);
}
console.log("Marketing mobile navigation applied");
