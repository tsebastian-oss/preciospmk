import fs from "node:fs";

const componentPath = "src/app/ClickHouseInsightView.tsx";
const cssPath = "src/app/ClickHouseInsightView.module.css";
const dataPath = "src/lib/clickhouse-insights.ts";

let component = fs.readFileSync(componentPath, "utf8");

// Invalidate the old session cache so users immediately receive the corrected,
// balanced ClickHouse brand universe after deployment.
component = component.replaceAll("mgp_ch_brands_v1", "mgp_ch_brands_v2");

const effectAnchor = `  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ mode, days:String(days) });`;
const guardedEffect = `  useEffect(() => {
    if (mode==="price-evolution" && !brand) { setPayload(null); setLoading(false); setError(""); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ mode, days:String(days) });`;
if (component.includes(effectAnchor)) component = component.replace(effectAnchor, guardedEffect);
else if (!component.includes('mode==="price-evolution" && !brand')) throw new Error("Insight fix: analysis effect anchor missing");

// Loading product options should not trigger a duplicate brand-level analytics query.
component = component.replace(
  "  }, [mode,brand,product,days,products]);",
  "  }, [mode,brand,product,days]);",
);

component = component.replace(
  '<option value="">Todas las marcas</option>',
  '<option value="">{mode==="price-evolution"?"Selecciona una marca":"Todas las marcas"}</option>',
);

const summaryAnchor = `    const rows=payload?.series??[]; return [{label:"Retailers",value:num(rows.length)},{label:"Series",value:num(rows.length)},{label:"Período",value:\`${"${days}"} días\`}];`;
const summaryReplacement = `    if (mode==="price-evolution" && !brand) return [{label:"Marca",value:"Selecciona una"},{label:"Producto",value:"Opcional"},{label:"Período",value:\`${"${days}"} días\`}];
    const rows=payload?.series??[]; return [{label:"Retailers",value:num(rows.length)},{label:"Series",value:num(rows.length)},{label:"Período",value:\`${"${days}"} días\`}];`;
if (component.includes(summaryAnchor)) component = component.replace(summaryAnchor, summaryReplacement);
else if (!component.includes('label:"Marca",value:"Selecciona una"')) throw new Error("Insight fix: evolution summary anchor missing");

const cardAnchor = `{loading ? <div className={styles.loading}><i/><span>Consultando ClickHouse…</span></div> : <InsightBody mode={mode} payload={payload} />}`;
const cardReplacement = `{mode==="price-evolution" && !brand ? <Empty text="Selecciona una marca para ver su evolución. Luego puedes elegir un producto específico."/> : loading ? <div className={styles.loading}><i/><span>Consultando ClickHouse…</span></div> : <InsightBody mode={mode} payload={payload} />}`;
if (component.includes(cardAnchor)) component = component.replace(cardAnchor, cardReplacement);
else if (!component.includes("Selecciona una marca para ver su evolución")) throw new Error("Insight fix: card anchor missing");

fs.writeFileSync(componentPath, component);

let css = fs.readFileSync(cssPath, "utf8");
const cssMarker = "/* insight-native-select-contrast-v2 */";
if (!css.includes(cssMarker)) {
  css += `\n${cssMarker}\n.root .filters select{background:#151b23!important;color:#edf0f4!important;-webkit-text-fill-color:#edf0f4!important;color-scheme:dark!important}.root .filters select option{background:#151b23!important;color:#edf0f4!important}.root .filters select:disabled{background:#10151c!important;color:#687382!important;-webkit-text-fill-color:#687382!important;opacity:1!important}.root .filters select:focus{background:#151b23!important;color:#fff!important}.root .filters select::-ms-value{background:#151b23!important;color:#edf0f4!important}\n`;
  fs.writeFileSync(cssPath, css);
}

let data = fs.readFileSync(dataPath, "utf8");
const brandFunction = /export async function clickHouseBrandOptions\(accessInput: EnterpriseAccessContext\) \{[\s\S]*?\n\}\n\nexport async function clickHouseProductOptions/;
if (!brandFunction.test(data) && !data.includes("retailer_rank <= 500")) {
  throw new Error("Insight fix: brand options function missing");
}
if (!data.includes("retailer_rank <= 500")) {
  const balancedFunction = `export async function clickHouseBrandOptions(accessInput: EnterpriseAccessContext) {
  const access = accessInput as ScopedAccess;
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  predicates.push("notEmpty(ifNull(p.brand, ''))");
  const rows = await clickHouseQuery<OptionRow>(\`
    SELECT value, sum(products) AS products
    FROM (
      SELECT
        value,
        retailer_type,
        products,
        row_number() OVER (PARTITION BY retailer_type ORDER BY products DESC, value ASC) AS retailer_rank
      FROM (
        SELECT
          ifNull(p.brand, '') AS value,
          p.retailer_type AS retailer_type,
          uniqExact(p.id) AS products
        FROM products AS p FINAL
        WHERE \${predicates.join("\\n          AND ")}
        GROUP BY value, retailer_type
      )
    )
    WHERE retailer_rank <= 500
    GROUP BY value
    ORDER BY products DESC, value ASC
    LIMIT 1500
  \`, params, 7_000);
  return rows.map((row) => ({ value: row.value, products: number(row.products) }));
}

export async function clickHouseProductOptions`;
  data = data.replace(brandFunction, balancedFunction);
  fs.writeFileSync(dataPath, data);
}

if (!component.includes("mgp_ch_brands_v2")) throw new Error("Insight fix: cache version was not bumped");
if (!css.includes(cssMarker)) throw new Error("Insight fix: select contrast CSS missing");
if (!data.includes("retailer_rank <= 500")) throw new Error("Insight fix: balanced brands query missing");

console.log("Insight filter contrast, balanced brand coverage and evolution guard applied");
