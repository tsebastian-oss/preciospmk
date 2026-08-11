import fs from "node:fs";

const target = "src/app/UnifiedPlatformApp.tsx";
let source = fs.readFileSync(target, "utf8");

// Stable URLs make browser/CDN caching possible and avoid forcing a brand-new request on every render.
source = source.replace(/\?live=\$\{Date\.now\(\)\}/g, "");
source = source.replace(/, \{ cache: "no-store" \}/g, "");
source = source.replace(/, \{ cache: "no-store", signal: controller\.signal \}/g, ", { signal: controller.signal }");

// Competitive AI should not download 1,000 matches just to paint the first screen.
source = source.replace('pageSize: competitiveMode ? "1000" : "30",', 'pageSize: competitiveMode ? "50" : "30",');

// Export history is not needed during initial dashboard bootstrap. Load it only when Downloads is opened.
source = source.replace(
`      const [dashboardResponse, pulseResponse, optionsResponse, exportsResponse] = await Promise.all([
        fetch(\`/api/dashboard\`),
        fetch(\`/api/weighted-price-pulse\`),
        fetch(\`/api/daily-pricing-filter-options\`),
        fetch(\`/api/data-exports\`),
      ]);
      const [dashboardData, pulseData, optionsData, exportsData] = await Promise.all([
        dashboardResponse.json() as Promise<DashboardPayload>,
        pulseResponse.json() as Promise<PulsePayload>,
        optionsResponse.json() as Promise<FilterPayload>,
        exportsResponse.json() as Promise<ExportPayload>,
      ]);`,
`      const [dashboardResponse, pulseResponse, optionsResponse] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/weighted-price-pulse"),
        fetch("/api/daily-pricing-filter-options"),
      ]);
      const [dashboardData, pulseData, optionsData] = await Promise.all([
        dashboardResponse.json() as Promise<DashboardPayload>,
        pulseResponse.json() as Promise<PulsePayload>,
        optionsResponse.json() as Promise<FilterPayload>,
      ]);`
);
source = source.replace('      if (exportsResponse.ok) setExportJobs(exportsData.exports ?? []);\n', '');

const productEffect = '  useEffect(() => { const timeout = window.setTimeout(() => void loadProducts(), 250); return () => window.clearTimeout(timeout); }, [loadProducts]);';
if (source.includes(productEffect)) {
  source = source.replace(productEffect,
'  useEffect(() => {\n    if (!["products", "promotions"].includes(view)) return;\n    const timeout = window.setTimeout(() => void loadProducts(), 150);\n    return () => window.clearTimeout(timeout);\n  }, [loadProducts, view]);');
}

const matchEffect = '  useEffect(() => { const timeout = window.setTimeout(() => void loadMatches(), 250); return () => window.clearTimeout(timeout); }, [loadMatches]);';
if (source.includes(matchEffect)) {
  source = source.replace(matchEffect,
'  useEffect(() => {\n    if (!["overview", "price-matching", "competitive", "basket", "assortment"].includes(view)) return;\n    const timeout = window.setTimeout(() => void loadMatches(), 150);\n    return () => window.clearTimeout(timeout);\n  }, [loadMatches, view]);');
}

// Refresh the expensive dashboard core every five minutes instead of every 30 seconds.
source = source.replace(
'    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 30000);',
'    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 300000);'
);

// Trend history is only required where it is actually visible.
source = source.replace(
'    if (!activeSeries.length) return;\n    const controller = new AbortController();',
'    if (!activeSeries.length || !["overview", "movements"].includes(view)) return;\n    const controller = new AbortController();'
);
source = source.replace('  }, [filters.period, seriesKey]);', '  }, [filters.period, seriesKey, view]);');

// Load export jobs on demand rather than blocking first paint.
const exportAnchor = '  useEffect(() => { const timeout = window.setTimeout(() => void loadProducts(),';
if (!source.includes('view !== "downloads"') && source.includes(exportAnchor)) {
  const index = source.indexOf(exportAnchor);
  const effect = `  useEffect(() => {\n    if (view !== "downloads") return;\n    const controller = new AbortController();\n    fetch("/api/data-exports", { signal: controller.signal })\n      .then(async (response) => {\n        const data = await response.json() as ExportPayload;\n        if (response.ok) setExportJobs(data.exports ?? []);\n      })\n      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setNotice("No fue posible cargar las exportaciones"); });\n    return () => controller.abort();\n  }, [view]);\n\n`;
  source = source.slice(0, index) + effect + source.slice(index);
}

fs.writeFileSync(target, source);
console.log("Applied runtime performance optimizations: lazy module fetches, 5m core refresh, smaller AI payloads, stable URLs.");
