import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const onboardingPath = "src/app/onboarding/page.tsx";

let app = fs.readFileSync(appPath, "utf8");

const replacements = [
  [
    'type RetailerType = "all" | "supermarket" | "department_store" | "pharmacy";',
    'type RetailerType = "all" | "supermarket" | "department_store" | "pharmacy" | "home_improvement";',
  ],
  [
    'const STORE_TYPES: Record<string, Exclude<RetailerType, "all">> = { lider: "supermarket", jumbo: "supermarket", "santa isabel": "supermarket", paris: "department_store", falabella: "department_store", ripley: "department_store", salcobrand: "pharmacy", "cruz verde": "pharmacy", "farmacias ahumada": "pharmacy", ahumada: "pharmacy" };',
    'const STORE_TYPES: Record<string, Exclude<RetailerType, "all">> = { lider: "supermarket", jumbo: "supermarket", "santa isabel": "supermarket", paris: "department_store", falabella: "department_store", ripley: "department_store", salcobrand: "pharmacy", "cruz verde": "pharmacy", "farmacias ahumada": "pharmacy", ahumada: "pharmacy", easy: "home_improvement", sodimac: "home_improvement" };',
  ],
  [
    '(["all", "supermarket", "department_store", "pharmacy"] as RetailerType[])',
    '(["all", "supermarket", "department_store", "pharmacy", "home_improvement"] as RetailerType[])',
  ],
  [
    'type === "all" ? "Todos" : type === "supermarket" ? "Supermercados" : type === "department_store" ? "Multitiendas" : "Farmacias"',
    'type === "all" ? "Todos" : type === "supermarket" ? "Supermercados" : type === "department_store" ? "Multitiendas" : type === "pharmacy" ? "Farmacias" : "Hogar y construcción"',
  ],
  [
    'type === "supermarket" ? "Supermercado" : type === "pharmacy" ? "Farmacia" : "Multitienda"',
    'type === "supermarket" ? "Supermercado" : type === "pharmacy" ? "Farmacia" : type === "home_improvement" ? "Hogar y construcción" : "Multitienda"',
  ],
];

for (const [before, after] of replacements) {
  if (app.includes(before)) app = app.replace(before, after);
  else if (!app.includes(after)) throw new Error(`Home improvement dashboard pattern not found: ${before.slice(0, 80)}`);
}

fs.writeFileSync(appPath, app);

let onboarding = fs.readFileSync(onboardingPath, "utf8");
const onboardingReplacements = [
  [
    'const CHANNEL_ICONS: Record<string, string> = { supermarket: "▦", pharmacy: "+", department_store: "▤" };',
    'const CHANNEL_ICONS: Record<string, string> = { supermarket: "▦", pharmacy: "+", department_store: "▤", home_improvement: "⌂" };',
  ],
  [
    'if (["textiles", "technology", "home", "toys", "sports"].includes(industry)) return ["department_store"];',
    'if (industry === "home") return ["home_improvement", "department_store"];\n  if (["textiles", "technology", "toys", "sports"].includes(industry)) return ["department_store"];',
  ],
  [
    'if (industry === "all" || industry === "other") return ["supermarket", "pharmacy", "department_store"];',
    'if (industry === "all" || industry === "other") return ["supermarket", "pharmacy", "department_store", "home_improvement"];',
  ],
  [
    'Puedes combinar supermercados, farmacias y multitiendas.',
    'Puedes combinar supermercados, farmacias, multitiendas y hogar/construcción.',
  ],
];

for (const [before, after] of onboardingReplacements) {
  if (onboarding.includes(before)) onboarding = onboarding.replace(before, after);
  else if (!onboarding.includes(after)) throw new Error(`Home improvement onboarding pattern not found: ${before.slice(0, 80)}`);
}
fs.writeFileSync(onboardingPath, onboarding);

const finalApp = fs.readFileSync(appPath, "utf8");
const finalOnboarding = fs.readFileSync(onboardingPath, "utf8");
for (const token of ['"home_improvement"', 'easy: "home_improvement"', 'sodimac: "home_improvement"', '"Hogar y construcción"']) {
  if (!finalApp.includes(token) && !finalOnboarding.includes(token)) throw new Error(`Missing home improvement UI token: ${token}`);
}
console.log("Home improvement UI applied");
