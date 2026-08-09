import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
let app = fs.readFileSync(appPath, "utf8");

const importAnchor = 'import AccountMenu from "./AccountMenu";';
const alertsImport = 'import CustomerAlerts from "./CustomerAlerts";';
if (!app.includes(alertsImport)) {
  if (!app.includes(importAnchor)) throw new Error("AccountMenu import missing before CustomerAlerts transform");
  app = app.replace(importAnchor, `${importAnchor}\n${alertsImport}`);
}

const start = app.indexOf('    if (view === "alerts") return ');
const endMarker = '\n\n    if (view === "scraping")';
const end = start >= 0 ? app.indexOf(endMarker, start) : -1;
if (start >= 0 && end > start) {
  app = `${app.slice(0, start)}    if (view === "alerts") return <CustomerAlerts/>;${app.slice(end)}`;
} else if (!app.includes('if (view === "alerts") return <CustomerAlerts/>;')) {
  throw new Error("Legacy alerts renderer pattern not found");
}

fs.writeFileSync(appPath, app);
console.log("Persistent customer alert center applied");
