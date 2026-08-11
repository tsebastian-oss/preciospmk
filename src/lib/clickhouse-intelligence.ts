import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export type IntelligenceToolName =
  | "search_products"
  | "get_price_history"
  | "compare_retailers"
  | "get_brand_snapshot"
  | "get_promotions"
  | "get_data_inventory";

type ToolArgs = Record<string, unknown>;

const SMART_CATEGORY = "coalesce(nullIf(trimBoth(p.smart_category), ''), nullIf(trimBoth(p.category), ''))";
const CURRENT_PRICE = "if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0)))";
const TODAY_SANTIAGO = "toDate(now(), 'America/Santiago')";

function addString(params: ClickHouseParams, name: string, value: string) {
  params[name] = { type: "String", value };
  return `{${name}:String}`;
}

function addStringList(
  predicates: string[],
  params: ClickHouseParams,
  column: string,
  values: string[],
  prefix: string,
) {
  const unique = [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, 100);
  if (!unique.length) return;
  const placeholders = unique.map((value, index) => addString(params, `${prefix}_${index}`, value));
  predicates.push(`${column} IN (${placeholders.join(", ")})`);
}

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max = 180) {
  const clean = text(value, max);
  return clean || null;
}

function stringArray(value: unknown, max = 12) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map((item) => text(item, 80)).filter(Boolean))].slice(0, max);
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function searchTokens(value: string) {
  const stop = new Set(["de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas", "y", "en", "con", "para"]);
  return [...new Set(value.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !stop.has(item)))]
    .slice(0, 8);
}

function addSearch(predicates: string[], params: ClickHouseParams, query: string, prefix: string) {
  const tokens = searchTokens(query);
  for (const [index, token] of tokens.entries()) {
    const placeholder = addString(params, `${prefix}_${index}`, token);
    predicates.push(`(
      positionCaseInsensitiveUTF8(p.name, ${placeholder}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(p.brand, ''), ${placeholder}) > 0
      OR positionCaseInsensitiveUTF8(ifNull(${SMART_CATEGORY}, ''), ${placeholder}) > 0
    )`);
  }
}

function addIndustryScope(predicates: string[], params: ClickHouseParams, access: EnterpriseAccessContext) {
  if (!access.industryConfigured || !access.industrySlug || access.industrySlug === "all") return;
  if (access.industrySlug === "grocery") {
    predicates.push("p.retailer_type = 'supermarket'");
    return;
  }
  predicates.push(`p.industry_slug = ${addString(params, "scope_industry", access.industrySlug)}`);
}

function scopedProductPredicates(access: EnterpriseAccessContext, params: ClickHouseParams) {
  const predicates = ["p.retailer_type IN ('supermarket', 'department_store', 'pharmacy', 'home_improvement')"];
  addStringList(predicates, params, "p.supermarket", access.retailers, "scope_retailer");
  addStringList(predicates, params, "p.brand", access.brands, "scope_brand");
  addStringList(predicates, params, SMART_CATEGORY, access.categories, "scope_category");
  addIndustryScope(predicates, params, access);
  return predicates;
}

function addRequestedFilters(
  predicates: string[],
  params: ClickHouseParams,
  args: ToolArgs,
  options: { allowRetailerType?: boolean; allowSupermarkets?: boolean; allowCategory?: boolean; allowBrand?: boolean },
) {
  if (options.allowRetailerType) {
    const retailerType = nullableText(args.retailerType, 40);
    if (retailerType && ["supermarket", "department_store", "pharmacy", "home_improvement"].includes(retailerType)) {
      predicates.push(`p.retailer_type = ${addString(params, "requested_retailer_type", retailerType)}`);
    }
  }
  if (options.allowSupermarkets) {
    const supermarkets = stringArray(args.supermarkets);
    addStringList(predicates, params, "p.supermarket", supermarkets, "requested_supermarket");
  }
  if (options.allowCategory) {
    const category = nullableText(args.category);
    if (category) predicates.push(`${SMART_CATEGORY} = ${addString(params, "requested_category", category)}`);
  }
  if (options.allowBrand) {
    const brand = nullableText(args.brand);
    if (brand) predicates.push(`p.brand = ${addString(params, "requested_brand", brand)}`);
  }
}

async function searchProducts(access: EnterpriseAccessContext, args: ToolArgs) {
  const params: ClickHouseParams = {};
  const predicates = scopedProductPredicates(access, params);
  addRequestedFilters(predicates, params, args, {
    allowRetailerType: true,
    allowSupermarkets: true,
    allowCategory: true,
    allowBrand: true,
  });

  const query = text(args.query);
  if (query) addSearch(predicates, params, query, "search");

  const stock = text(args.stock, 10);
  if (stock === "in") predicates.push("s.in_stock = true");
  if (stock === "out") predicates.push("s.in_stock = false");
  predicates.push(`${CURRENT_PRICE} > 0`);

  const limit = integer(args.limit, 12, 1, 25);
  params.limit = { type: "UInt16", value: limit };

  const rows = await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      toString(p.id) AS product_id,
      p.name,
      p.brand,
      ${SMART_CATEGORY} AS category,
      p.supermarket AS retailer,
      p.retailer_type,
      p.external_id,
      ${CURRENT_PRICE} AS current_price,
      if(toFloat64(ifNull(s.regular_price, 0)) > 0, toFloat64(s.regular_price), NULL) AS regular_price,
      if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), NULL) AS offer_price,
      s.in_stock,
      if(
        toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE} AND ${CURRENT_PRICE} > 0,
        round((toFloat64(s.regular_price) - ${CURRENT_PRICE}) / toFloat64(s.regular_price) * 100, 1),
        0
      ) AS discount_pct,
      toString(s.observed_at) AS observed_at,
      p.url
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY s.in_stock DESC, s.observed_at DESC, p.name ASC
    LIMIT {limit:UInt16}
  `, params, 7_000);

  return {
    found: rows.length > 0,
    query: query || null,
    products: rows,
    guardrails: {
      currentState: true,
      differentPackSizesMayNotBeComparable: true,
    },
    source: "clickhouse",
  };
}

async function getPriceHistory(access: EnterpriseAccessContext, args: ToolArgs) {
  const params: ClickHouseParams = {};
  const predicates = scopedProductPredicates(access, params);
  addRequestedFilters(predicates, params, args, {
    allowRetailerType: true,
    allowSupermarkets: true,
    allowCategory: true,
    allowBrand: true,
  });

  const query = nullableText(args.query);
  if (query) addSearch(predicates, params, query, "history_search");

  const days = integer(args.days, 30, 7, 365);
  params.days_back = { type: "UInt16", value: days - 1 };
  predicates.push(`d.price_date >= subtractDays(${TODAY_SANTIAGO}, {days_back:UInt16})`);
  predicates.push("d.effective_price > 0");

  type Row = {
    date: string;
    retailer: string;
    median_price: number | string;
    average_price: number | string;
    min_price: number | string;
    max_price: number | string;
    products: number | string;
    examples: string[];
  };

  const rows = await clickHouseQuery<Row>(`
    SELECT
      toString(d.price_date) AS date,
      d.supermarket AS retailer,
      round(quantileTDigest(0.5)(toFloat64(d.effective_price)), 0) AS median_price,
      round(avg(toFloat64(d.effective_price)), 0) AS average_price,
      min(toFloat64(d.effective_price)) AS min_price,
      max(toFloat64(d.effective_price)) AS max_price,
      uniqExact(d.product_id) AS products,
      arraySlice(groupUniqArray(p.name), 1, 5) AS examples
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY d.price_date, d.supermarket
    ORDER BY d.price_date ASC, d.supermarket ASC
  `, params, 8_000);

  const byRetailer = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byRetailer.get(row.retailer) ?? [];
    list.push(row);
    byRetailer.set(row.retailer, list);
  }

  const variation = [...byRetailer.entries()].map(([retailer, points]) => {
    const first = points[0];
    const last = points[points.length - 1];
    const firstPrice = Number(first?.median_price ?? 0);
    const lastPrice = Number(last?.median_price ?? 0);
    return {
      retailer,
      firstDate: first?.date ?? null,
      lastDate: last?.date ?? null,
      firstMedianPrice: firstPrice || null,
      lastMedianPrice: lastPrice || null,
      variationPct: firstPrice > 0 && lastPrice > 0 ? Math.round((lastPrice / firstPrice - 1) * 1000) / 10 : null,
    };
  });

  return {
    found: rows.length > 0,
    query,
    daysRequested: days,
    points: rows,
    retailerVariation: variation,
    partialCurrentDay: rows.some((row) => row.date === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date())),
    guardrails: {
      medianPreferredForMixedCatalogs: true,
      differentPackSizesMayNotBeComparable: true,
      currentDayMayBePartial: true,
    },
    source: "clickhouse",
  };
}

async function compareRetailers(access: EnterpriseAccessContext, args: ToolArgs) {
  const params: ClickHouseParams = {};
  const predicates = scopedProductPredicates(access, params);
  addRequestedFilters(predicates, params, args, {
    allowRetailerType: true,
    allowSupermarkets: true,
    allowCategory: true,
    allowBrand: true,
  });
  const query = nullableText(args.query);
  if (query) addSearch(predicates, params, query, "compare_search");
  predicates.push(`${CURRENT_PRICE} > 0`);

  const rows = await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      countIf(s.in_stock) AS in_stock,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      min(${CURRENT_PRICE}) AS min_price,
      max(${CURRENT_PRICE}) AS max_price,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct,
      toString(max(s.observed_at)) AS last_observed_at,
      arraySlice(groupUniqArray(p.name), 1, 5) AS examples
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.supermarket
    ORDER BY median_price ASC, products DESC
  `, params, 7_000);

  return {
    found: rows.length > 0,
    query,
    retailers: rows,
    priceBasis: "median_current_price",
    guardrails: { differentPackSizesMayNotBeComparable: true },
    source: "clickhouse",
  };
}

async function getBrandSnapshot(access: EnterpriseAccessContext, args: ToolArgs) {
  const brand = text(args.brand);
  if (!brand) return { found: false, error: "brand_required", source: "clickhouse" };

  const params: ClickHouseParams = {};
  const predicates = scopedProductPredicates(access, params);
  predicates.push(`p.brand = ${addString(params, "snapshot_brand", brand)}`);
  addRequestedFilters(predicates, params, args, {
    allowRetailerType: true,
    allowSupermarkets: true,
    allowCategory: true,
    allowBrand: false,
  });
  predicates.push(`${CURRENT_PRICE} > 0`);

  const overall = (await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      uniqExact(p.id) AS products,
      uniqExact(p.supermarket) AS retailers,
      countIf(s.in_stock) AS in_stock,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      min(${CURRENT_PRICE}) AS min_price,
      max(${CURRENT_PRICE}) AS max_price,
      toString(max(s.observed_at)) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
  `, params, 7_000))[0] ?? null;

  const retailers = await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      countIf(s.in_stock) AS in_stock,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      toString(max(s.observed_at)) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.supermarket
    ORDER BY products DESC
  `, params, 7_000);

  const categories = await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      ${SMART_CATEGORY} AS category,
      uniqExact(p.id) AS products,
      uniqExact(p.supermarket) AS retailers
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
      AND notEmpty(ifNull(${SMART_CATEGORY}, ''))
    GROUP BY category
    ORDER BY products DESC
    LIMIT 10
  `, params, 7_000);

  return {
    found: Number(overall?.products ?? 0) > 0,
    brand,
    summary: overall,
    retailerBreakdown: retailers,
    topCategories: categories,
    priceBasis: "median_current_price",
    source: "clickhouse",
  };
}

async function getPromotions(access: EnterpriseAccessContext, args: ToolArgs) {
  const params: ClickHouseParams = {};
  const predicates = scopedProductPredicates(access, params);
  addRequestedFilters(predicates, params, args, {
    allowRetailerType: true,
    allowSupermarkets: true,
    allowCategory: true,
    allowBrand: true,
  });
  const query = nullableText(args.query);
  if (query) addSearch(predicates, params, query, "promotion_search");
  predicates.push("toFloat64(ifNull(s.regular_price, 0)) > 0");
  predicates.push(`${CURRENT_PRICE} > 0`);
  predicates.push(`toFloat64(s.regular_price) > ${CURRENT_PRICE}`);

  const limit = integer(args.limit, 15, 1, 30);
  params.limit = { type: "UInt16", value: limit };

  const rows = await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      p.name,
      p.brand,
      ${SMART_CATEGORY} AS category,
      p.supermarket AS retailer,
      toFloat64(s.regular_price) AS regular_price,
      ${CURRENT_PRICE} AS offer_price,
      round((toFloat64(s.regular_price) - ${CURRENT_PRICE}) / toFloat64(s.regular_price) * 100, 1) AS discount_pct,
      s.in_stock,
      toString(s.observed_at) AS observed_at,
      p.url
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY discount_pct DESC, s.observed_at DESC
    LIMIT {limit:UInt16}
  `, params, 7_000);

  return {
    found: rows.length > 0,
    promotions: rows,
    source: "clickhouse",
  };
}

async function getDataInventory(access: EnterpriseAccessContext, args: ToolArgs) {
  const params: ClickHouseParams = {};
  const predicates = scopedProductPredicates(access, params);
  const days = integer(args.days, 30, 7, 365);
  params.days_back = { type: "UInt16", value: days - 1 };
  predicates.push(`d.price_date >= subtractDays(${TODAY_SANTIAGO}, {days_back:UInt16})`);

  const summary = (await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      toString(min(d.price_date)) AS first_date,
      toString(max(d.price_date)) AS last_date,
      uniqExact(d.price_date) AS available_days,
      uniqExact(d.product_id) AS products,
      uniqExact(d.supermarket) AS retailers,
      uniqExact(ifNull(d.brand, '')) AS brands,
      uniqExact(ifNull(${SMART_CATEGORY}, '')) AS categories,
      toString(max(d.observed_at)) AS last_observed_at,
      countIf(d.price_date = ${TODAY_SANTIAGO}) AS current_day_rows,
      countIf(d.price_date = subtractDays(${TODAY_SANTIAGO}, 1)) AS previous_day_rows
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
  `, params, 7_000))[0] ?? null;

  const retailers = await clickHouseQuery<Record<string, unknown>>(`
    SELECT
      d.supermarket AS retailer,
      p.retailer_type,
      uniqExact(d.product_id) AS products,
      toString(min(d.price_date)) AS first_date,
      toString(max(d.price_date)) AS last_date
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY d.supermarket, p.retailer_type
    ORDER BY products DESC
  `, params, 7_000);

  return {
    found: Number(summary?.products ?? 0) > 0,
    daysRequested: days,
    summary,
    retailerCoverage: retailers,
    currentDayMayBePartial: true,
    source: "clickhouse",
  };
}

export async function executeIntelligenceTool(
  name: IntelligenceToolName,
  args: ToolArgs,
  access: EnterpriseAccessContext,
) {
  switch (name) {
    case "search_products": return searchProducts(access, args);
    case "get_price_history": return getPriceHistory(access, args);
    case "compare_retailers": return compareRetailers(access, args);
    case "get_brand_snapshot": return getBrandSnapshot(access, args);
    case "get_promotions": return getPromotions(access, args);
    case "get_data_inventory": return getDataInventory(access, args);
    default: return { found: false, error: "unknown_tool", source: "clickhouse" };
  }
}
