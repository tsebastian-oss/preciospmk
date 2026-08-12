import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
let app = fs.readFileSync(appPath, "utf8");

const stylesImport = 'import styles from "./UnifiedPlatformApp.module.css";';
const accountImport = 'import AccountMenu from "./AccountMenu";';
if (!app.includes(accountImport)) {
  if (!app.includes(stylesImport)) throw new Error("UnifiedPlatformApp styles import not found");
  app = app.replace(stylesImport, `${stylesImport}\n${accountImport}`);
}

const oldAccount = '<div className={styles.account}><div><span>MG</span><div><strong>MGP Team</strong><small>Administrador</small></div></div><hr/><small>Plan Enterprise</small><p>{number(summary?.total_products)} SKU monitoreados</p><div><i style={{ width: `${Math.min(100, stockCoverage)}%` }}/></div><strong><em/> Pipeline operativo</strong></div>';
const legacyAccountMenu = '<AccountMenu skuCount={number(summary?.total_products)} stockCoverage={stockCoverage}/>';
const newAccount = '<AccountMenu/>';

if (app.includes(oldAccount)) {
  app = app.replace(oldAccount, newAccount);
} else if (app.includes(legacyAccountMenu)) {
  app = app.replace(legacyAccountMenu, newAccount);
} else if (!app.includes(newAccount)) {
  throw new Error("Dashboard account block pattern not found");
}

fs.writeFileSync(appPath, app);
