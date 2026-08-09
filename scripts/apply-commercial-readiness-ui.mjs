import fs from "node:fs";

const appPath = "src/app/UnifiedPlatformApp.tsx";
const cssPath = "src/app/UnifiedPlatformApp.module.css";
let app = fs.readFileSync(appPath, "utf8");
let changed = false;

function replaceOnce(label, oldValue, newValue) {
  if (app.includes(newValue)) return;
  if (!app.includes(oldValue)) throw new Error(`Commercial readiness pattern not found: ${label}`);
  app = app.replace(oldValue, newValue);
  changed = true;
}

const accountImport = 'import AccountMenu from "./AccountMenu";';
const commercialImport = 'import { ActivationGuide, CommercialBanner, minimumPlanForView, requiredModuleForView, type CommercialAccountPayload } from "./CommercialExperience";';
const oldCommercialImport = 'import { ActivationGuide, CommercialBanner, requiredModuleForView, type CommercialAccountPayload } from "./CommercialExperience";';
if (app.includes(oldCommercialImport)) {
  app = app.replace(oldCommercialImport, commercialImport);
  changed = true;
} else if (!app.includes(commercialImport)) {
  if (!app.includes(accountImport)) throw new Error("AccountMenu import must be applied before commercial readiness");
  app = app.replace(accountImport, `${accountImport}\n${commercialImport}`);
  changed = true;
}

replaceOnce(
  "commercial account state",
  '  const [notice, setNotice] = useState("");',
  '  const [notice, setNotice] = useState("");\n  const [commercialAccount, setCommercialAccount] = useState<CommercialAccountPayload | null>(null);',
);

const summaryAnchor = '  const summary = dashboard?.summary;';
if (!app.includes('const enabledModules = useMemo(() => new Set(commercialAccount?.organization?.modules ?? []), [commercialAccount]);')) {
  if (!app.includes(summaryAnchor)) throw new Error("Summary anchor not found");
  const block = `  useEffect(() => {
    let cancelled = false;
    fetch("/api/enterprise/account", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CommercialAccountPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar el plan");
        if (!cancelled) setCommercialAccount(payload);
      })
      .catch(() => { if (!cancelled) setCommercialAccount(null); });
    return () => { cancelled = true; };
  }, []);

  const enabledModules = useMemo(() => new Set(commercialAccount?.organization?.modules ?? []), [commercialAccount]);
  const exportLimit = Number(commercialAccount?.organization?.commercial?.limits?.exports_per_month ?? commercialAccount?.organization?.limits?.exports_per_month ?? 0);
  const exportsUsed = Number(commercialAccount?.organization?.commercial?.usage?.exportsThisMonth ?? 0);
  const exportLimitReached = exportLimit > 0 && exportsUsed >= exportLimit;
  function viewAllowed(next: View) {
    if (!commercialAccount) return true;
    const required = requiredModuleForView(next);
    return !required || enabledModules.has(required);
  }

`;
  app = app.replace(summaryAnchor, `${block}${summaryAnchor}`);
  changed = true;
}

replaceOnce(
  "plan-aware navigation",
  '  function navigate(next: View) { setView(next); setMobileOpen(false); setProductPage(1); setMatchPage(1); window.history.replaceState(null, "", `#${next}`); window.scrollTo({ top: 0, behavior: "smooth" }); }',
  '  function navigate(next: View) { if (!viewAllowed(next)) { setNotice(`Este módulo requiere ${minimumPlanForView(next)} o superior.`); return; } setView(next); setMobileOpen(false); setProductPage(1); setMatchPage(1); window.history.replaceState(null, "", `#${next}`); window.scrollTo({ top: 0, behavior: "smooth" }); }',
);

const navOld = '{group.items.map((item) => <button key={item.view} className={view === item.view ? styles.activeNav : ""} onClick={() => navigate(item.view)}><i>{item.icon}</i><span>{item.label}</span>{item.view === "alerts" && alerts.length > 0 && <b>{alerts.length}</b>}</button>)}';
const navLegacyPlan = '{group.items.map((item) => { const allowed = viewAllowed(item.view); return <button key={item.view} className={view === item.view ? styles.activeNav : ""} onClick={() => navigate(item.view)} disabled={!allowed} title={allowed ? item.label : "Disponible en un plan superior"}><i>{item.icon}</i><span>{item.label}</span>{!allowed && <small className={styles.planLock}>Business</small>}{item.view === "alerts" && alerts.length > 0 && allowed && <b>{alerts.length}</b>}</button>; })}';
const navNew = '{group.items.map((item) => { const allowed = viewAllowed(item.view); const minimumPlan = minimumPlanForView(item.view); return <button key={item.view} className={view === item.view ? styles.activeNav : ""} onClick={() => navigate(item.view)} disabled={!allowed} title={allowed ? item.label : `Disponible desde ${minimumPlan}`}><i>{item.icon}</i><span>{item.label}</span>{!allowed && <small className={styles.planLock}>{minimumPlan}</small>}{item.view === "alerts" && alerts.length > 0 && allowed && <b>{alerts.length}</b>}</button>; })}';
if (app.includes(navLegacyPlan)) { app = app.replace(navLegacyPlan, navNew); changed = true; }
else replaceOnce("plan-aware sidebar", navOld, navNew);

replaceOnce(
  "commercial banner",
  '      {notice && <div className={styles.notice}>{notice}<button onClick={() => setNotice("")}>×</button></div>}',
  '      <CommercialBanner account={commercialAccount}/>\n      {notice && <div className={styles.notice}>{notice}<button onClick={() => setNotice("")}>×</button></div>}',
);

replaceOnce(
  "activation guide",
  '      return <><section className={styles.metrics}>',
  '      return <><ActivationGuide currentView={view} onNavigate={navigate} account={commercialAccount}/><section className={styles.metrics}>',
);

replaceOnce(
  "export quota subtitle",
  '<CardHead title="Configura la exportación" subtitle="Los filtros globales se aplican al archivo"/>',
  '<CardHead title="Configura la exportación" subtitle={exportLimit > 0 ? `${exportsUsed}/${exportLimit} exportaciones usadas este mes` : "Los filtros globales se aplican al archivo"}/>',
);
replaceOnce(
  "export quota button",
  '<button className={styles.primaryButton} disabled={generatingExport}>{generatingExport ? "Generando…" : "Generar y descargar"}</button>',
  '<button className={styles.primaryButton} disabled={generatingExport || exportLimitReached}>{generatingExport ? "Generando…" : exportLimitReached ? "Límite mensual alcanzado" : "Generar y descargar"}</button>',
);

replaceOnce(
  "actionable alerts",
  '<button>Revisar →</button></article>)',
  '<button onClick={() => navigate(item.tone === "info" ? "price-matching" : "movements")}>Revisar →</button></article>)',
);

const fakePreferences = '<article className={styles.card}><CardHead title="Preferencias del dashboard" subtitle="Configuración visual y de actualización"/><div className={styles.toggleRows}><label><span><strong>Actualización automática</strong><small>Recargar indicadores cada 30 segundos</small></span><input type="checkbox" defaultChecked/></label><label><span><strong>Mostrar datos en vivo</strong><small>Incluir el día en curso en las tendencias</small></span><input type="checkbox" defaultChecked/></label><label><span><strong>Alertas de scraping</strong><small>Destacar fuentes con errores o retrasos</small></span><input type="checkbox" defaultChecked/></label></div></article>';
const realPreferences = '<article className={styles.card}><CardHead title="Cuenta y plan" subtitle="Configuración que sí queda guardada"/><div className={styles.settingRow}><div><strong>Alcance y permisos</strong><p>Administra industria y retailers desde onboarding; revisa usuarios, uso y plan desde Mi cuenta.</p></div><a href="/cuenta">Abrir Mi cuenta</a></div><div className={styles.settingRow}><div><strong>Industria y retailers</strong><p>Los cambios recalculan automáticamente el dashboard dentro del alcance autorizado.</p></div><a href="/onboarding?change=1">Configurar alcance</a></div></article>';
replaceOnce("remove fake dashboard preferences", fakePreferences, realPreferences);

const replacements = [
  ['detail="Tres supermercados"', 'detail="Productos equivalentes"'],
  ['subtitle="Cobertura completa en tres cadenas"', 'subtitle="Cobertura según el alcance actual"'],
  ['description: "Compara productos homologados entre Lider, Jumbo y Santa Isabel."', 'description: "Compara productos equivalentes entre los retailers disponibles en tu alcance."'],
  ['<strong>MGP Intelligence</strong><small>Commerce Decision Platform</small>', '<strong>MGP Super Precios</strong><small>Retail Intelligence Platform</small>'],
  ['?? "MGP Intelligence";', '?? "MGP Super Precios";'],
  ['{ label: "Data & Operations", items:', '{ label: "Datos & Operación", items:'],
];
for (const [oldValue, newValue] of replacements) {
  if (app.includes(oldValue)) { app = app.replace(oldValue, newValue); changed = true; }
}

if (!app.includes('useEffect(() => {\n    if (!commercialAccount) return;\n    const required = requiredModuleForView(view);')) {
  const anchor = '  const activeCopy = COPY[view];';
  if (!app.includes(anchor)) throw new Error("Active copy anchor not found");
  const guard = `  useEffect(() => {
    if (!commercialAccount) return;
    const required = requiredModuleForView(view);
    if (required && !enabledModules.has(required)) {
      setView("overview");
      window.history.replaceState(null, "", "#overview");
      setNotice(`Este módulo requiere ${minimumPlanForView(view)} o superior. Volvimos al Resumen Ejecutivo.`);
    }
  }, [commercialAccount, enabledModules, view]);

`;
  app = app.replace(anchor, `${guard}${anchor}`);
  changed = true;
}

fs.writeFileSync(appPath, app);

let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* commercial-readiness-v1 */";
if (!css.includes(marker)) {
  css += `\n${marker}\n.navigation button:disabled{cursor:not-allowed;opacity:.58}.navigation button:disabled:hover{background:transparent}.planLock{margin-left:auto!important;padding:3px 5px;border-radius:999px;background:#ede9fe;color:#6d45c7!important;font-size:7px!important;font-weight:900;letter-spacing:.03em}.primaryButton:disabled{cursor:not-allowed;opacity:.58}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log(changed ? "Commercial readiness UI applied" : "Commercial readiness UI already applied");
