import fs from "node:fs";

const target = "src/app/UnifiedPlatformApp.tsx";
let source = fs.readFileSync(target, "utf8");

// Keep real-time endpoints (notably pharmacy coverage) untouched. Stabilize only the
// bootstrap requests that do not need a unique URL on every page load.
const stableRequests = [
  [
    'fetch(`/api/dashboard?live=${Date.now()}`, { cache: "no-store" })',
    'fetch("/api/dashboard")',
  ],
  [
    'fetch(`/api/weighted-price-pulse?live=${Date.now()}`, { cache: "no-store" })',
    'fetch("/api/weighted-price-pulse")',
  ],
  [
    'fetch(`/api/daily-pricing-filter-options?live=${Date.now()}`, { cache: "no-store" })',
    'fetch("/api/daily-pricing-filter-options")',
  ],
  [
    'fetch(`/api/data-exports?live=${Date.now()}`, { cache: "no-store" })',
    'fetch("/api/data-exports")',
  ],
];
for (const [from, to] of stableRequests) source = source.replace(from, to);

// Export history is not needed during initial dashboard bootstrap. Load it only when Downloads is opened.
source = source.replace(
`      const [dashboardResponse, pulseResponse, optionsResponse, exportsResponse] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/weighted-price-pulse"),
        fetch("/api/daily-pricing-filter-options"),
        fetch("/api/data-exports"),
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

// Refresh the core dashboard every five minutes instead of every 30 seconds.
source = source.replace(
  '    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 30000);',
  '    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadCore(true); }, 300000);',
);

// Load export jobs on demand rather than blocking first paint.
if (!source.includes('if (view !== "downloads") return;')) {
  const anchor = '  const summary = dashboard?.summary;';
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error("Performance anchor not found");
  const effect = `  useEffect(() => {\n    if (view !== "downloads") return;\n    const controller = new AbortController();\n    fetch("/api/data-exports", { signal: controller.signal })\n      .then(async (response) => {\n        const data = await response.json() as ExportPayload;\n        if (response.ok) setExportJobs(data.exports ?? []);\n      })\n      .catch((error) => {\n        if (error instanceof DOMException && error.name === "AbortError") return;\n        setNotice("No fue posible cargar las exportaciones");\n      });\n    return () => controller.abort();\n  }, [view]);\n\n`;
  source = source.slice(0, index) + effect + source.slice(index);
}

fs.writeFileSync(target, source);
console.log("Applied runtime performance optimizations: lighter bootstrap, on-demand exports and 5m core refresh.");
