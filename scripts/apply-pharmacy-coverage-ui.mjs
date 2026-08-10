import fs from "node:fs";

const target = "src/app/UnifiedPlatformApp.tsx";
let source = fs.readFileSync(target, "utf8");

const dashboardType = "type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; categories: CategorySummary[]; run: CrawlRun | null; topOffers: Product[]; error?: string };";

if (!source.includes("type PharmacyCoverageRow =")) {
  if (!source.includes(dashboardType)) throw new Error("DashboardPayload anchor not found");
  source = source.replace(dashboardType, `type PharmacyCoverageRow = {
  retailer: string;
  runId: number | null;
  runStatus: string;
  status: string;
  discoveredUrls: number;
  capturedUrls: number;
  capturedProducts: number;
  missingUrls: number;
  coveragePct: number | null;
  taskProgressPct: number | null;
  discoveryComplete: boolean;
  queuedTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  startedAt: string | null;
  finishedAt: string | null;
};
type PharmacyCoveragePayload = {
  checkedAt?: string | null;
  parallel?: boolean;
  retailers: PharmacyCoverageRow[];
  unavailable?: boolean;
  error?: string;
};
${dashboardType}`);
}

if (!source.includes("const [pharmacyCoverage, setPharmacyCoverage]")) {
  const stateAnchor = "  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);";
  if (!source.includes(stateAnchor)) throw new Error("Dashboard state anchor not found");
  source = source.replace(stateAnchor, `${stateAnchor}\n  const [pharmacyCoverage, setPharmacyCoverage] = useState<PharmacyCoveragePayload | null>(null);\n  const [loadingPharmacyCoverage, setLoadingPharmacyCoverage] = useState(false);`);
}

if (!source.includes("/api/pharmacy-coverage?live=")) {
  const dashboardSetAnchor = "      setDashboard(dashboardData);";
  if (!source.includes(dashboardSetAnchor)) throw new Error("Dashboard load anchor not found");
  source = source.replace(dashboardSetAnchor, `${dashboardSetAnchor}
      setLoadingPharmacyCoverage(true);
      void fetch(\`/api/pharmacy-coverage?live=\${Date.now()}\`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json() as PharmacyCoveragePayload;
          if (response.ok) setPharmacyCoverage(data);
          else setPharmacyCoverage((current) => ({ ...(current ?? { retailers: [] }), unavailable: true, error: data.error || "Cobertura temporalmente no disponible" }));
        })
        .catch(() => setPharmacyCoverage((current) => ({ ...(current ?? { retailers: [] }), unavailable: true, error: "Cobertura temporalmente no disponible" })))
        .finally(() => setLoadingPharmacyCoverage(false));`);
}

const productsEffect = "  useEffect(() => { const timeout = window.setTimeout(() => void loadProducts(), 250); return () => window.clearTimeout(timeout); }, [loadProducts]);";
if (source.includes(productsEffect)) {
  source = source.replace(productsEffect, `  useEffect(() => {
    if (!(["products", "promotions"] as View[]).includes(view)) return;
    const timeout = window.setTimeout(() => void loadProducts(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadProducts, view]);`);
}

const matchesEffect = "  useEffect(() => { const timeout = window.setTimeout(() => void loadMatches(), 250); return () => window.clearTimeout(timeout); }, [loadMatches]);";
if (source.includes(matchesEffect)) {
  source = source.replace(matchesEffect, `  useEffect(() => {
    if (!(["overview", "price-matching", "competitive", "optimizer", "basket"] as View[]).includes(view)) return;
    const timeout = window.setTimeout(() => void loadMatches(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadMatches, view]);`);
}

const trendGuard = "    if (!activeSeries.length) return;";
if (source.includes(trendGuard) && !source.includes("!([\"overview\", \"movements\"] as View[]).includes(view)")) {
  source = source.replace(trendGuard, "    if (!activeSeries.length || !([\"overview\", \"movements\"] as View[]).includes(view)) return;");
  source = source.replace("  }, [filters.period, seriesKey]);", "  }, [filters.period, seriesKey, view]);");
}

const navigateAnchor = "  function navigate(next: View) { setView(next);";
if (source.includes(navigateAnchor)) {
  source = source.replace(navigateAnchor, "  function navigate(next: View) { setNotice(\"\"); setView(next);");
}

if (!source.includes("pharmacyCoverageCards")) {
  const start = source.indexOf('    if (view === "scraping") return ');
  const end = source.indexOf('\n\n    return <section className={styles.workspace}>', start);
  if (start < 0 || end < 0) throw new Error("Scraping view anchor not found");

  const replacement = `    if (view === "scraping") {
      const pharmacyRows = pharmacyCoverage?.retailers ?? [];
      const measuredCoverage = pharmacyRows.filter((item) => item.coveragePct !== null);
      const averageCoverage = measuredCoverage.length
        ? measuredCoverage.reduce((sum, item) => sum + (item.coveragePct ?? 0), 0) / measuredCoverage.length
        : null;
      const runningPharmacies = pharmacyRows.filter((item) => item.runStatus === "running").length;
      const pharmacyErrors = pharmacyRows.reduce((sum, item) => sum + numeric(item.failedTasks), 0);
      const pharmacyMissing = pharmacyRows.reduce((sum, item) => sum + numeric(item.missingUrls), 0);
      return <section className={\`\${styles.workspace} pharmacyStatusWorkspace\`}>
        <div className="pharmacyStatusIntro">
          <div><span>MONITOREO DE CATÁLOGO</span><h2>Estado de captura por farmacia</h2><p>Las tres cadenas corren de forma independiente. La cobertura es provisional mientras el descubrimiento siga abierto.</p></div>
          <button onClick={() => void loadCore()} disabled={loadingCore || loadingPharmacyCoverage}>{loadingCore || loadingPharmacyCoverage ? "Actualizando…" : "Actualizar datos"}</button>
        </div>

        <section className="pharmacyKpiGrid">
          <article><span>Farmacias activas</span><strong>{pharmacyRows.length || 3}</strong><small>{runningPharmacies ? runningPharmacies + " farmacias corriendo en paralelo" : "Monitoreo independiente"}</small></article>
          <article><span>Cobertura promedio</span><strong>{averageCoverage === null ? "Midiendo" : averageCoverage.toFixed(2) + "%"}</strong><small>Capturadas / descubiertas</small></article>
          <article><span>URLs pendientes</span><strong>{number(pharmacyMissing)}</strong><small>{pharmacyRows.some((item) => !item.discoveryComplete) ? "Puede variar mientras descubre" : "Brecha final identificada"}</small></article>
          <article><span>Tareas fallidas</span><strong>{number(pharmacyErrors)}</strong><small>{pharmacyErrors ? "Requieren revisión" : "Sin errores registrados"}</small></article>
        </section>

        <article className={\`\${styles.card} pharmacyCoveragePanel\`}>
          <header className="pharmacyPanelHeader"><div><h2>Cobertura de catálogo · Farmacias</h2><p>Avance real por cadena, run y catálogo descubierto.</p></div><span>{pharmacyCoverage?.checkedAt ? "Actualizado " + displayDate(pharmacyCoverage.checkedAt) : "Actualizando"}</span></header>
          {loadingPharmacyCoverage && !pharmacyRows.length ? <div className="pharmacyCoverageLoading">Midiendo cobertura de las tres farmacias…</div> : pharmacyCoverage?.unavailable && !pharmacyRows.length ? <div className="pharmacyCoverageUnavailable">La cobertura no respondió en esta actualización. El resto del dashboard sigue operativo.</div> : <div className="pharmacyCoverageCards">{pharmacyRows.map((item) => {
            const progress = item.taskProgressPct ?? 0;
            const statusLabel = item.runStatus === "running" ? (item.discoveryComplete ? "Capturando" : "Descubriendo") : item.runStatus === "completed" || item.runStatus === "completed_with_errors" ? "Finalizado" : item.runStatus || "Sin iniciar";
            return <article key={item.retailer} className="pharmacyCoverageCard">
              <header><div><span className="pharmacyStatusDot"/><strong>{item.retailer}</strong></div><b data-status={item.runStatus}>{statusLabel}</b></header>
              <div className="pharmacyCoverageValue"><strong>{item.coveragePct === null ? "—" : item.coveragePct.toFixed(2) + "%"}</strong><span>Cobertura</span></div>
              <div className="pharmacyProgressTrack"><i style={{ width: Math.min(100, Math.max(0, progress)) + "%" }}/></div>
              <small className="pharmacyProgressLabel">{item.discoveryComplete ? "Descubrimiento completo" : "Avance de tareas " + (item.taskProgressPct === null ? "—" : item.taskProgressPct.toFixed(1) + "%")}</small>
              <dl><div><dt>Capturadas</dt><dd>{number(item.capturedUrls)}</dd></div><div><dt>Descubiertas</dt><dd>{number(item.discoveredUrls)}</dd></div><div><dt>Faltantes</dt><dd>{number(item.missingUrls)}</dd></div><div><dt>Fallidas</dt><dd>{number(item.failedTasks)}</dd></div></dl>
              <footer>Run {item.runId ?? "—"} · {item.queuedTasks ? number(item.queuedTasks) + " en cola" : "cola limpia"}</footer>
            </article>;
          })}</div>}
        </article>

        <article className={\`\${styles.card} pharmacyPipelinePanel\`}>
          <header className="pharmacyPanelHeader"><div><h2>Pipeline por retailer</h2><p>Última actividad y tamaño del catálogo visible.</p></div></header>
          <div className="pharmacyPipelineRows">{(dashboard?.supermarkets ?? []).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><strong>{number(item.products)} SKU</strong><small>{displayDate(item.last_updated)}</small></div>)}</div>
        </article>
      </section>;
    }`;

  source = source.slice(0, start) + replacement + source.slice(end);
}

fs.writeFileSync(target, source);
console.log("Applied tidy pharmacy coverage UI and scoped background data loads");
