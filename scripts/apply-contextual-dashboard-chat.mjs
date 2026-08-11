import fs from "node:fs";

function requireReplace(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Contextual dashboard patch anchor missing: ${label}`);
  return source.replace(from, to);
}

// 1) Make the existing GPT-5.6 agent expose a deterministic dashboard context
// derived from successful ClickHouse tool calls, not from free-form prose.
const aiPath = "src/lib/openai-intelligence.ts";
let ai = fs.readFileSync(aiPath, "utf8");
if (!ai.includes("type IntelligenceDashboardContext =")) {
  ai = requireReplace(ai,
`export type IntelligenceAgentResult = {`,
`export type IntelligenceDashboardContext = {
  query: string | null;
  brand: string | null;
  category: string | null;
  retailers: string[];
  days: number;
  scope: "product" | "brand" | "category" | "market";
};

export type IntelligenceAgentResult = {`,
  "agent-result-type");

  ai = requireReplace(ai,
`  brand: string | null;
};`,
`  brand: string | null;
  dashboardContext: IntelligenceDashboardContext | null;
};`,
  "agent-result-context-field");

  const modelStart = ai.indexOf("function modelCandidates() {");
  const modelEnd = ai.indexOf("\nfunction errorCategory", modelStart);
  if (modelStart < 0 || modelEnd < 0) throw new Error("Contextual dashboard patch anchor missing: modelCandidates");
  ai = ai.slice(0, modelStart) + `function modelCandidates() {
  return [...new Set([
    OPENAI_MODEL,
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ].map((item) => item.trim()).filter(Boolean))].slice(0, 3);
}
` + ai.slice(modelEnd);

  const helper = `type DashboardSignal = { name: IntelligenceToolName; args: Record<string, unknown>; result: unknown };

function dashboardContextFromSignals(signals: DashboardSignal[], filters: IntelligenceFilters): IntelligenceDashboardContext | null {
  let query: string | null = null;
  let brand: string | null = null;
  let category: string | null = null;
  let retailers: string[] = [];
  let selectedDays = Number(filters.period) || 30;

  for (let index = signals.length - 1; index >= 0; index -= 1) {
    const signal = signals[index];
    const args = signal.args ?? {};
    if (!query && typeof args.query === "string" && args.query.trim()) query = args.query.trim().slice(0, 220);
    if (!brand && typeof args.brand === "string" && args.brand.trim()) brand = args.brand.trim().slice(0, 140);
    if (!category && typeof args.category === "string" && args.category.trim()) category = args.category.trim().slice(0, 180);
    if (!retailers.length && Array.isArray(args.supermarkets)) {
      retailers = [...new Set(args.supermarkets.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].slice(0, 12);
    }
    if (Number.isFinite(Number(args.days))) selectedDays = Math.max(7, Math.min(365, Number(args.days)));

    const result = signal.result as { products?: Array<Record<string, unknown>> } | null;
    const products = Array.isArray(result?.products) ? result!.products! : [];
    if (products.length) {
      const count = (field: string) => {
        const map = new Map<string, number>();
        for (const product of products) {
          const value = typeof product[field] === "string" ? String(product[field]).trim() : "";
          if (value) map.set(value, (map.get(value) ?? 0) + 1);
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      };
      if (!brand) brand = count("brand");
      if (!category) category = count("category");
      if (!retailers.length) retailers = [...new Set(products.map((product) => typeof product.retailer === "string" ? product.retailer.trim() : "").filter(Boolean))].slice(0, 12);
    }
  }

  brand = brand || (filters.brand?.trim() || null);
  category = category || (filters.category?.trim() || null);
  if (!retailers.length && filters.supermarket?.trim()) retailers = [filters.supermarket.trim()];
  if (!query && !brand && !category && !retailers.length && !signals.length) return null;

  return {
    query,
    brand,
    category,
    retailers,
    days: selectedDays,
    scope: query ? "product" : brand ? "brand" : category ? "category" : "market",
  };
}

`;
  ai = requireReplace(ai, "async function runWithModel(\n", helper + "async function runWithModel(\n", "runWithModel-helper");
  ai = requireReplace(ai, "  const trace: string[] = [];\n", "  const trace: string[] = [];\n  const dashboardSignals: DashboardSignal[] = [];\n", "dashboard-signals-state");
  ai = requireReplace(ai,
`        const result = await executeIntelligenceTool(name, args, access);
        outputs.push({`,
`        const result = await executeIntelligenceTool(name, args, access);
        dashboardSignals.push({ name, args, result });
        outputs.push({`,
  "capture-successful-tool-context");
  ai = ai.replace(/        brand: likelyBrand\(messages, filters\),\n/g, "        brand: likelyBrand(messages, filters),\n        dashboardContext: dashboardContextFromSignals(dashboardSignals, filters),\n");
  ai = ai.replace(/    brand: likelyBrand\(messages, filters\),\n/g, "    brand: likelyBrand(messages, filters),\n    dashboardContext: dashboardContextFromSignals(dashboardSignals, filters),\n");
  fs.writeFileSync(aiPath, ai);
}

// 2) Let every ClickHouse dashboard calculation accept a product/free-text context.
const dataPath = "src/lib/clickhouse-dashboard.ts";
let data = fs.readFileSync(dataPath, "utf8");
if (!data.includes("query?: string | null;")) {
  data = requireReplace(data,
`type DashboardFilters = {
  retailer?: string | null;`,
`type DashboardFilters = {
  query?: string | null;
  retailer?: string | null;`,
  "dashboard-query-type");

  const searchHelper = `function searchTokens(value: string) {
  const stop = new Set(["de","del","la","las","el","los","un","una","unos","unas","y","en","con","para","por"]);
  return [...new Set(value.toLocaleLowerCase("es-CL").replace(/[^\\p{L}\\p{N}]+/gu, " ").split(/\\s+/).map((item) => item.trim()).filter((item) => item.length >= 2 && !stop.has(item)))].slice(0, 8);
}

function applyQuery(predicates: string[], params: ClickHouseParams, value: string, alias = "p") {
  for (const [index, token] of searchTokens(value).entries()) {
    const placeholder = addString(params, "requested_query_" + index, token);
    predicates.push(
      "(" +
      "positionCaseInsensitiveUTF8(" + alias + ".name, " + placeholder + ") > 0" +
      " OR positionCaseInsensitiveUTF8(ifNull(" + alias + ".brand, ''), " + placeholder + ") > 0" +
      " OR positionCaseInsensitiveUTF8(ifNull(" + smartCategory(alias) + ", ''), " + placeholder + ") > 0" +
      ")"
    );
  }
}

`;
  data = requireReplace(data, "function days(value: number | undefined) {", searchHelper + "function days(value: number | undefined) {", "dashboard-search-helper");
  data = requireReplace(data,
`  const retailer = clean(filters.retailer, 100);
  const category = clean(filters.category, 180);
  const brand = clean(filters.brand, 180);`,
`  const query = clean(filters.query, 220);
  const retailer = clean(filters.retailer, 100);
  const category = clean(filters.category, 180);
  const brand = clean(filters.brand, 180);`,
  "dashboard-requested-query");
  data = requireReplace(data,
`  if (options.retailer && retailer) predicates.push`,
`  if (query) applyQuery(predicates, params, query, alias);
  if (options.retailer && retailer) predicates.push`,
  "dashboard-apply-query");
  data = requireReplace(data,
`  const filters: DashboardFilters = {
    retailer: clean(filtersInput.retailer, 100) || null,`,
`  const filters: DashboardFilters = {
    query: clean(filtersInput.query, 220) || null,
    retailer: clean(filtersInput.retailer, 100) || null,`,
  "dashboard-normalize-query");
  fs.writeFileSync(dataPath, data);
}

const routePath = "src/app/api/clickhouse-dashboard/route.ts";
let route = fs.readFileSync(routePath, "utf8");
if (!route.includes('query: request.nextUrl.searchParams.get("query")')) {
  route = requireReplace(route,
`    const payload = await clickHouseDashboard(authorization.access, {
      retailer: request.nextUrl.searchParams.get("retailer"),`,
`    const payload = await clickHouseDashboard(authorization.access, {
      query: request.nextUrl.searchParams.get("query"),
      retailer: request.nextUrl.searchParams.get("retailer"),`,
  "dashboard-route-query");
  fs.writeFileSync(routePath, route);
}

// 3) Replace the Price Gaps panel with the conversational analyst and wire its
// context into all surrounding ClickHouse charts.
const overviewPath = "src/app/ClickHouseOverview.tsx";
let overview = fs.readFileSync(overviewPath, "utf8");
if (!overview.includes("DashboardContextChat")) {
  overview = requireReplace(overview,
`import styles from "./ClickHouseOverview.module.css";`,
`import styles from "./ClickHouseOverview.module.css";
import DashboardContextChat, { type DashboardAiContext } from "./DashboardContextChat";`,
  "overview-chat-import");

  overview = requireReplace(overview,
`  filters: { retailer: string | null; category: string | null; brand: string | null; days: number };`,
`  filters: { query: string | null; retailer: string | null; category: string | null; brand: string | null; days: number };`,
  "overview-payload-query");

  overview = requireReplace(overview,
`  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);`,
`  const [days, setDays] = useState(30);
  const [aiContext, setAiContext] = useState<DashboardAiContext | null>(null);
  const [loading, setLoading] = useState(true);`,
  "overview-ai-context-state");

  overview = requireReplace(overview,
`    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    if (retailer) params.set("retailer", retailer);
    if (category) params.set("category", category);
    if (brand) params.set("brand", brand);`,
`    const params = new URLSearchParams({ days: String(days), live: String(Date.now()) });
    const effectiveCategory = category || aiContext?.category || "";
    const effectiveBrand = brand || aiContext?.brand || "";
    if (aiContext?.query) params.set("query", aiContext.query);
    if (retailer) params.set("retailer", retailer);
    if (effectiveCategory) params.set("category", effectiveCategory);
    if (effectiveBrand) params.set("brand", effectiveBrand);`,
  "overview-context-load");

  overview = requireReplace(overview,
`  }, [retailer, category, brand, days]);`,
`  }, [retailer, category, brand, days, aiContext]);`,
  "overview-context-deps");

  overview = requireReplace(overview,
`      <button className={styles.clearFilters} onClick={() => { setRetailer(""); setCategory(""); setBrand(""); setDays(30); }}>⌁ Limpiar</button>
    </section>

    {error &&`,
`      <button className={styles.clearFilters} onClick={() => { setRetailer(""); setCategory(""); setBrand(""); setDays(30); setAiContext(null); }}>⌁ Limpiar</button>
    </section>

    {aiContext && <div className={styles.aiContextBanner}><span>✦ CONTEXTO IA</span><strong>{aiContext.query || aiContext.brand || aiContext.category || "Mercado"}</strong>{aiContext.category && <em>{aiContext.category}</em>}<button onClick={() => setAiContext(null)}>Restablecer</button></div>}

    {error &&`,
  "overview-context-banner");

  const gapStart = overview.indexOf('        <article className={`${styles.card} ${styles.gapsCard}`}>');
  const gapEnd = overview.indexOf("\n\n        <aside className={styles.rightRail}>", gapStart);
  if (gapStart < 0 || gapEnd < 0) throw new Error("Contextual dashboard patch anchor missing: gaps-card");
  const chatBlock = `        <div className={styles.gapsCard}>
          <DashboardContextChat
            filters={{ retailer, category, brand, days }}
            activeContext={aiContext}
            onContextChange={(context) => {
              setAiContext(context);
              if (context?.days && [7, 30, 90].includes(Number(context.days))) setDays(Number(context.days));
            }}
          />
        </div>`;
  overview = overview.slice(0, gapStart) + chatBlock + overview.slice(gapEnd);
  fs.writeFileSync(overviewPath, overview);
}

const overviewCssPath = "src/app/ClickHouseOverview.module.css";
let overviewCss = fs.readFileSync(overviewCssPath, "utf8");
if (!overviewCss.includes(".aiContextBanner{")) {
  overviewCss += `.aiContextBanner{display:flex;align-items:center;gap:9px;margin:-3px 0 11px;padding:8px 10px;border:1px solid #4b4112;border-radius:8px;background:linear-gradient(90deg,#1d1a0d,#11161d);color:#8591a1;font-size:9px}.aiContextBanner span{color:#e0bd1d;font-weight:900;letter-spacing:.08em}.aiContextBanner strong{max-width:440px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f3f5f7;font-size:10px}.aiContextBanner em{padding:3px 6px;border-radius:999px;background:#242819;color:#b5a956;font-size:8px;font-style:normal}.aiContextBanner button{margin-left:auto;border:0;background:transparent;color:#8f99a8;font-size:8.5px;font-weight:800}@media(max-width:640px){.aiContextBanner{flex-wrap:wrap}.aiContextBanner button{margin-left:0}}`;
  fs.writeFileSync(overviewCssPath, overviewCss);
}

console.log("Contextual GPT-5.6 dashboard chat ready");
