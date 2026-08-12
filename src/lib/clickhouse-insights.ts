import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export type ClickHouseInsightMode =
  | "price-evolution"
  | "retailer-benchmark"
  | "market-coverage"
  | "price-gaps"
  | "price-alerts"
  | "products"
  | "data-status";

export type ClickHouseInsightFilters = {
  brand?: string | null;
  product?: string | null;
  days?: number;
};

type ScopedAccess = EnterpriseAccessContext & {
  industryConfigured?: boolean;
  industrySlug?: string | null;
};

type Numeric = number | string;

type OptionRow = { value: string; products: Numeric };
type ProductOptionRow = {
  id: string;
  name: string;
  brand: string;
  retailer: string;
  latest_price: Numeric;
  last_observed_at: string | null;
};
type EvolutionRow = { date: string; retailer: string; price: Numeric; products: Numeric };
type RetailerRow = {
  retailer: string;
  products: Numeric;
  median_price: Numeric;
  average_price: Numeric;
  min_price: Numeric;
  max_price: Numeric;
  in_stock: Numeric;
  availability_pct: Numeric;
  last_observed_at: string | null;
};
type GapRow = {
  brand: string;
  category: string;
  retailers: Numeric;
  products: Numeric;
  low_retailer: string;
  high_retailer: string;
  low_price: Numeric;
  high_price: Numeric;
  gap_pct: Numeric;
};
type AlertRow = {
  name: string;
  brand: string | null;
  retailer: string;
  previous_price: Numeric;
  current_price: Numeric;
  change_pct: Numeric;
  observed_at: string | null;
};
type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  retailer: string;
  price: Numeric;
  regular_price: Numeric;
  in_stock: boolean;
  observed_at: string | null;
  url: string;
};
type StatusRow = {
  retailer: string;
  products: Numeric;
  latest_observed_at: string | null;
  observations_24h: Numeric;
};

const CURRENT_PRICE = "if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0)))";

function number(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: string | null | undefined, max = 220) {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function period(value: number | undefined) {
  return [7, 30, 90].includes(Number(value)) ? Number(value) : 30;
}

function smartCategory(alias = "p") {
  return `coalesce(nullIf(trimBoth(${alias}.smart_category), ''), nullIf(trimBoth(${alias}.category), ''))`;
}

function addString(params: ClickHouseParams, name: string, value: string) {
  params[name] = { type: "String", value };
  return `{${name}:String}`;
}

function addStringList(predicates: string[], params: ClickHouseParams, column: string, values: string[], prefix: string) {
  const unique = [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, 100);
  if (!unique.length) return;
  const placeholders = unique.map((value, index) => addString(params, `${prefix}_${index}`, value));
  predicates.push(`${column} IN (${placeholders.join(", ")})`);
}

function searchTokens(value: string) {
  const stop = new Set(["de", "del", "la", "las", "el", "los", "un", "una", "unos", "unas", "y", "en", "con", "para", "por"]);
  return [...new Set(value.toLocaleLowerCase("es-CL").replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).map((item) => item.trim()).filter((item) => item.length >= 2 && !stop.has(item)))].slice(0, 8);
}

function basePredicates(access: ScopedAccess, params: ClickHouseParams, alias = "p") {
  const predicates = [`${alias}.retailer_type IN ('supermarket', 'department_store', 'pharmacy', 'home_improvement')`];
  addStringList(predicates, params, `${alias}.supermarket`, access.retailers ?? [], "scope_retailer");
  addStringList(predicates, params, `${alias}.brand`, access.brands ?? [], "scope_brand");
  addStringList(predicates, params, smartCategory(alias), access.categories ?? [], "scope_category");
  if (access.industryConfigured && access.industrySlug && access.industrySlug !== "all") {
    if (access.industrySlug === "grocery") predicates.push(`${alias}.retailer_type = 'supermarket'`);
    else predicates.push(`${alias}.industry_slug = ${addString(params, "scope_industry", access.industrySlug)}`);
  }
  return predicates;
}

function applyFilters(predicates: string[], params: ClickHouseParams, filters: ClickHouseInsightFilters, alias = "p") {
  const brand = clean(filters.brand, 160);
  const product = clean(filters.product, 220);
  if (brand) predicates.push(`${alias}.brand = ${addString(params, "requested_brand", brand)}`);
  searchTokens(product).forEach((token, index) => {
    const placeholder = addString(params, `product_token_${index}`, token);
    predicates.push(`(positionCaseInsensitiveUTF8(${alias}.name, ${placeholder}) > 0 OR positionCaseInsensitiveUTF8(ifNull(${alias}.brand, ''), ${placeholder}) > 0)`);
  });
}

export async function clickHouseBrandOptions(accessInput: EnterpriseAccessContext) {
  const access = accessInput as ScopedAccess;
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  predicates.push("notEmpty(ifNull(p.brand, ''))");
  const rows = await clickHouseQuery<OptionRow>(`
    SELECT ifNull(p.brand, '') AS value, uniqExact(p.id) AS products
    FROM products AS p FINAL
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY value
    ORDER BY products DESC, value ASC
    LIMIT 250
  `, params, 5_000);
  return rows.map((row) => ({ value: row.value, products: number(row.products) }));
}

export async function clickHouseProductOptions(accessInput: EnterpriseAccessContext, brandInput: string) {
  const access = accessInput as ScopedAccess;
  const brand = clean(brandInput, 160);
  if (!brand) return [];
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  predicates.push(`p.brand = ${addString(params, "requested_brand", brand)}`);
  predicates.push(`${CURRENT_PRICE} > 0`);
  const rows = await clickHouseQuery<ProductOptionRow>(`
    SELECT
      toString(p.id) AS id,
      p.name,
      ifNull(p.brand, '') AS brand,
      p.supermarket AS retailer,
      ${CURRENT_PRICE} AS latest_price,
      toString(s.observed_at) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY s.in_stock DESC, s.observed_at DESC, p.name ASC
    LIMIT 300
  `, params, 6_000);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    retailer: row.retailer,
    latestPrice: number(row.latest_price),
    lastObservedAt: row.last_observed_at,
  }));
}

async function evolution(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  const params: ClickHouseParams = { days_back: { type: "UInt16", value: period(filters.days) - 1 } };
  const predicates = basePredicates(access, params);
  applyFilters(predicates, params, filters);
  predicates.push("d.effective_price > 0");
  predicates.push("d.price_date >= subtractDays(toDate(now(), 'America/Santiago'), {days_back:UInt16})");
  const rows = await clickHouseQuery<EvolutionRow>(`
    SELECT
      toString(d.price_date) AS date,
      p.supermarket AS retailer,
      round(quantileTDigest(0.5)(toFloat64(d.effective_price)), 0) AS price,
      uniqExact(d.product_id) AS products
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY d.price_date, p.supermarket
    ORDER BY d.price_date ASC, p.supermarket ASC
  `, params, 7_000);
  const retailers = [...new Set(rows.map((row) => row.retailer))];
  return {
    series: retailers.map((retailer) => ({
      retailer,
      points: rows.filter((row) => row.retailer === retailer).map((row) => ({ date: row.date, price: number(row.price), products: number(row.products) })),
    })),
  };
}

async function retailerBenchmark(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyFilters(predicates, params, filters);
  predicates.push(`${CURRENT_PRICE} > 0`);
  const rows = await clickHouseQuery<RetailerRow>(`
    SELECT
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      round(min(${CURRENT_PRICE}), 0) AS min_price,
      round(max(${CURRENT_PRICE}), 0) AS max_price,
      countIf(s.in_stock) AS in_stock,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      toString(max(s.observed_at)) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.supermarket
    ORDER BY median_price ASC
  `, params, 6_000);
  return { retailers: rows.map((row) => ({
    retailer: row.retailer,
    products: number(row.products),
    medianPrice: number(row.median_price),
    averagePrice: number(row.average_price),
    minPrice: number(row.min_price),
    maxPrice: number(row.max_price),
    inStock: number(row.in_stock),
    availabilityPct: number(row.availability_pct),
    lastObservedAt: row.last_observed_at,
  })) };
}

async function coverage(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  return retailerBenchmark(access, filters);
}

async function gaps(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyFilters(predicates, params, filters);
  predicates.push(`${CURRENT_PRICE} > 0`);
  predicates.push("notEmpty(ifNull(p.brand, ''))");
  predicates.push(`notEmpty(ifNull(${smartCategory()}, ''))`);
  const rows = await clickHouseQuery<GapRow>(`
    SELECT
      brand,
      category,
      uniqExact(retailer) AS retailers,
      sum(products) AS products,
      argMin(retailer, median_price) AS low_retailer,
      argMax(retailer, median_price) AS high_retailer,
      min(median_price) AS low_price,
      max(median_price) AS high_price,
      round((high_price - low_price) / greatest(low_price, 1) * 100, 1) AS gap_pct
    FROM (
      SELECT
        ifNull(p.brand, '') AS brand,
        ${smartCategory()} AS category,
        p.supermarket AS retailer,
        uniqExact(p.id) AS products,
        round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price
      FROM products AS p FINAL
      INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
      WHERE ${predicates.join("\n        AND ")}
      GROUP BY brand, category, retailer
      HAVING products >= 1 AND median_price > 0
    )
    GROUP BY brand, category
    HAVING retailers >= 2 AND high_price > low_price
    ORDER BY gap_pct DESC, products DESC
    LIMIT 30
  `, params, 7_000);
  return { gaps: rows.map((row) => ({
    brand: row.brand,
    category: row.category,
    retailers: number(row.retailers),
    products: number(row.products),
    lowRetailer: row.low_retailer,
    highRetailer: row.high_retailer,
    lowPrice: number(row.low_price),
    highPrice: number(row.high_price),
    gapPct: number(row.gap_pct),
  })) };
}

async function alerts(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyFilters(predicates, params, filters);
  predicates.push("d.effective_price > 0");
  const rows = await clickHouseQuery<AlertRow>(`
    WITH
      toDate(now(), 'America/Santiago') AS latest_date,
      subtractDays(latest_date, 1) AS previous_date
    SELECT
      name,
      brand,
      retailer,
      previous_price,
      current_price,
      round((current_price - previous_price) / previous_price * 100, 1) AS change_pct,
      observed_at
    FROM (
      SELECT
        p.id,
        p.name AS name,
        p.brand AS brand,
        p.supermarket AS retailer,
        maxIf(toFloat64(d.effective_price), d.price_date = previous_date) AS previous_price,
        maxIf(toFloat64(d.effective_price), d.price_date = latest_date) AS current_price,
        toString(maxIf(d.observed_at, d.price_date = latest_date)) AS observed_at
      FROM daily_pricing_live AS d FINAL
      INNER JOIN products AS p FINAL ON p.id = d.product_id
      WHERE ${predicates.join("\n        AND ")}
        AND d.price_date IN (latest_date, previous_date)
      GROUP BY p.id, p.name, p.brand, p.supermarket
    )
    WHERE previous_price > 0 AND current_price > 0 AND previous_price != current_price
    ORDER BY abs(change_pct) DESC
    LIMIT 80
  `, params, 7_000);
  return { alerts: rows.map((row) => ({
    name: row.name,
    brand: row.brand,
    retailer: row.retailer,
    previousPrice: number(row.previous_price),
    currentPrice: number(row.current_price),
    changePct: number(row.change_pct),
    observedAt: row.observed_at,
  })) };
}

async function products(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyFilters(predicates, params, filters);
  predicates.push(`${CURRENT_PRICE} > 0`);
  const rows = await clickHouseQuery<ProductRow>(`
    SELECT
      toString(p.id) AS id,
      p.name,
      p.brand,
      ${smartCategory()} AS category,
      p.supermarket AS retailer,
      ${CURRENT_PRICE} AS price,
      toFloat64(ifNull(s.regular_price, 0)) AS regular_price,
      s.in_stock AS in_stock,
      toString(s.observed_at) AS observed_at,
      p.url AS url
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY s.observed_at DESC
    LIMIT 120
  `, params, 6_000);
  return { products: rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    retailer: row.retailer,
    price: number(row.price),
    regularPrice: number(row.regular_price),
    inStock: Boolean(row.in_stock),
    observedAt: row.observed_at,
    url: row.url,
  })) };
}

async function dataStatus(access: ScopedAccess, filters: ClickHouseInsightFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyFilters(predicates, params, filters);
  const rows = await clickHouseQuery<StatusRow>(`
    SELECT
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      toString(max(s.observed_at)) AS latest_observed_at,
      countIf(s.observed_at >= subtractHours(now(), 24)) AS observations_24h
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.supermarket
    ORDER BY latest_observed_at DESC
  `, params, 6_000);
  return { retailers: rows.map((row) => ({
    retailer: row.retailer,
    products: number(row.products),
    latestObservedAt: row.latest_observed_at,
    observations24h: number(row.observations_24h),
  })) };
}

export async function clickHouseInsight(accessInput: EnterpriseAccessContext, mode: ClickHouseInsightMode, filters: ClickHouseInsightFilters) {
  const access = accessInput as ScopedAccess;
  const normalized = { brand: clean(filters.brand, 160) || null, product: clean(filters.product, 220) || null, days: period(filters.days) };
  let data: Record<string, unknown>;
  if (mode === "price-evolution") data = await evolution(access, normalized);
  else if (mode === "retailer-benchmark") data = await retailerBenchmark(access, normalized);
  else if (mode === "market-coverage") data = await coverage(access, normalized);
  else if (mode === "price-gaps") data = await gaps(access, normalized);
  else if (mode === "price-alerts") data = await alerts(access, normalized);
  else if (mode === "products") data = await products(access, normalized);
  else data = await dataStatus(access, normalized);
  return { source: "clickhouse" as const, mode, filters: normalized, generatedAt: new Date().toISOString(), ...data };
}
