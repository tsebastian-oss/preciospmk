import fs from "node:fs";

const target = "src/app/UnifiedPlatformApp.tsx";
let source = fs.readFileSync(target, "utf8");

if (!source.includes("type PharmacyCoverageRow =")) {
  const anchor = "type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; categories: CategorySummary[]; run: CrawlRun | null; topOffers: Product[]; error?: string };";
  if (!source.includes(anchor)) throw new Error("DashboardPayload anchor not found");
  source = source.replace(anchor, `type PharmacyCoverageRow = {
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
type PharmacyCoveragePayload = { checkedAt?: string | null; parallel?: boolean; retailers: PharmacyCoverageRow[] };
type DashboardPayload = { summary: Summary | null; supermarkets: RetailerSummary[]; categories: CategorySummary[]; run: CrawlRun | null; topOffers: Product[]; pharmacyCoverage?: PharmacyCoveragePayload; error?: string };`);
}

if (!source.includes("const pharmacyCoverage = dashboard?.pharmacyCoverage?.retailers ?? []")) {
  const start = source.indexOf('    if (view === "scraping") return ');
  const end = source.indexOf('\n\n    return <section className={styles.workspace}>', start);
  if (start < 0 || end < 0) throw new Error("Scraping view anchor not found");

  const replacement = `    if (view === "scraping") {
      const pharmacyCoverage = dashboard?.pharmacyCoverage?.retailers ?? [];
      const measuredCoverage = pharmacyCoverage.filter((item) => item.coveragePct !== null);
      const averageCoverage = measuredCoverage.length
        ? measuredCoverage.reduce((sum, item) => sum + (item.coveragePct ?? 0), 0) / measuredCoverage.length
        : null;
      const pharmacyErrors = pharmacyCoverage.reduce((sum, item) => sum + numeric(item.failedTasks), 0);
      return <section className={styles.workspace}>
        <section className={styles.metrics}>
          <Metric label="Estado general" value={dashboard?.run?.status === "running" ? "Procesando" : "Operativo"} detail={pharmacyCoverage.length ? pharmacyCoverage.filter((item) => item.runStatus === "running").length + " farmacias corriendo en paralelo" : "Run " + (dashboard?.run?.id ?? "—")} tone="green"/>
          <Metric label="Cobertura farmacias" value={averageCoverage === null ? "Midiendo" : averageCoverage.toFixed(2) + "%"} detail="URLs capturadas / descubiertas" tone={averageCoverage !== null && averageCoverage >= 99 ? "green" : "purple"}/>
          <Metric label="Errores farmacias" value={number(pharmacyErrors)} detail="Tareas fallidas en runs activos" tone={pharmacyErrors ? "orange" : "green"}/>
          <Metric label="Productos encontrados" value={number(dashboard?.run?.products_found)} detail="En la corrida actual" tone="purple"/>
        </section>
        {pharmacyCoverage.length > 0 && <article className={styles.card}>
          <CardHead title="Cobertura de catálogo · Farmacias" subtitle="Runs independientes y paralelos por cadena" action="Actualizar" onAction={() => void loadCore()}/>
          <div className={styles.scrapeRows}>{pharmacyCoverage.map((item) => <div key={item.retailer}>
            <span><i/>{item.retailer}</span>
            <b>{item.coveragePct === null ? "Midiendo" : item.coveragePct.toFixed(2) + "%"}</b>
            <strong>{number(item.capturedUrls)} / {number(item.discoveredUrls)}</strong>
            <small>{item.discoveryComplete ? number(item.missingUrls) + " faltantes" : "Descubriendo · " + (item.taskProgressPct === null ? "—" : item.taskProgressPct.toFixed(1) + "%") + " avance"} · Run {item.runId ?? "—"}</small>
          </div>)}</div>
        </article>}
        <article className={styles.card}><CardHead title="Pipeline por retailer" subtitle="Última actividad registrada" action="Actualizar" onAction={() => void loadCore()}/><div className={styles.scrapeRows}>{(dashboard?.supermarkets ?? []).map((item) => <div key={item.supermarket}><span><i/>{item.supermarket}</span><b>Operativo</b><strong>{number(item.products)} SKU</strong><small>{displayDate(item.last_updated)}</small></div>)}</div></article>
      </section>;
    }`;

  source = source.slice(0, start) + replacement + source.slice(end);
}

fs.writeFileSync(target, source);
console.log("Applied pharmacy coverage UI");
