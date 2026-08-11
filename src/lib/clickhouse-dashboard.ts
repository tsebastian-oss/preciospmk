import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

type DashboardFilters = {
  retailer?: string | null;
  category?: string | null;
  brand?: string | null;
  days?: number;
};

type ScopedAccess = EnterpriseAccessContext & {
  industryConfigured?: boolean;
  industrySlug?: string | null;
};

type Numeric = number | string;

type SummaryRow = {
  monitored_products: Numeric;
  retailers: Numeric;
  average_price: Numeric;
  median_price: Numeric;
  in_stock_products: Numeric;
  availability_pct: Numeric;
  promotions: Numeric;
  promotion_pct: Numeric;
  last_observed_at: string | null;
};

type TrendRow = {
  date: string;
  average_price: Numeric;
  median_price: Numeric;
  products: Numeric;
};

type RetailerRow = {
  retailer: string;
  products: Numeric;
  in_stock: Numeric;
  availability_pct: Numeric;
  average_price: Numeric;
  median_price: Numeric;
  promotions: Numeric;
  promotion_pct: Numeric;
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

type PromotionRow = {
  name: string;
  brand: string | null;
  category: string | null;
  retailer: string;
  regular_price: Numeric;
  offer_price: Numeric;
  discount_pct: Numeric;
  observed_at: string | null;
};

type ChangeRow = {
  name: string;
  brand: string | null;
  retailer: string;
  previous_price: Numeric;
  current_price: Numeric;
  change_pct: Numeric;
  observed_at: string | null;
  total_changes: Numeric;
};

type OptionRow = {
  dimension: "category" | "brand";
  value: string;
  products: Numeric;
};

const CURRENT_PRICE = "if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0)))";

function smartCategory(alias = "p") {
  return `coalesce(nullIf(trimBoth(${alias}.smart_category), ''), nullIf(trimBoth(${alias}.category), ''))`;
}

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

function clean(value: string | null | undefined, max = 180) {
  return (value ?? "").trim().slice(0, max);
}

function days(value: number | undefined) {
  return [7, 30, 90].includes(Number(value)) ? Number(value) : 30;
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

function applyRequested(
  predicates: string[],
  params: ClickHouseParams,
  filters: DashboardFilters,
  alias = "p",
  options: { retailer?: boolean; category?: boolean; brand?: boolean } = { retailer: true, category: true, brand: true },
) {
  const retailer = clean(filters.retailer, 100);
  const category = clean(filters.category, 180);
  const brand = clean(filters.brand, 180);
  if (options.retailer && retailer) predicates.push(`${alias}.supermarket = ${addString(params, "requested_retailer", retailer)}`);
  if (options.category && category) predicates.push(`${smartCategory(alias)} = ${addString(params, "requested_category", category)}`);
  if (options.brand && brand) predicates.push(`${alias}.brand = ${addString(params, "requested_brand", brand)}`);
}

function currentPredicates(access: ScopedAccess, params: ClickHouseParams, filters: DashboardFilters) {
  const predicates = basePredicates(access, params);
  applyRequested(predicates, params, filters);
  predicates.push(`${CURRENT_PRICE} > 0`);
  return predicates;
}

async function summary(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = {};
  const predicates = currentPredicates(access, params, filters);
  const rows = await clickHouseQuery<SummaryRow>(`
    SELECT
      uniqExact(p.id) AS monitored_products,
      uniqExact(p.supermarket) AS retailers,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      countIf(s.in_stock) AS in_stock_products,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct,
      toString(max(s.observed_at)) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
  `, params, 8_000);
  return rows[0] ?? null;
}

async function trend(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = { days_back: { type: "UInt16", value: days(filters.days) - 1 } };
  const predicates = basePredicates(access, params);
  applyRequested(predicates, params, filters);
  predicates.push("d.effective_price > 0");
  predicates.push("d.price_date >= subtractDays(toDate(now(), 'America/Santiago'), {days_back:UInt16})");
  return clickHouseQuery<TrendRow>(`
    SELECT
      toString(d.price_date) AS date,
      round(avg(toFloat64(d.effective_price)), 0) AS average_price,
      round(quantileTDigest(0.5)(toFloat64(d.effective_price)), 0) AS median_price,
      uniqExact(d.product_id) AS products
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY d.price_date
    ORDER BY d.price_date ASC
  `, params, 8_000);
}

async function retailerBreakdown(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = {};
  const predicates = currentPredicates(access, params, filters);
  return clickHouseQuery<RetailerRow>(`
    SELECT
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      countIf(s.in_stock) AS in_stock,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct,
      toString(max(s.observed_at)) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.supermarket
    ORDER BY products DESC
  `, params, 8_000);
}

async function gaps(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = {};
  const predicates = currentPredicates(access, params, filters);
  predicates.push("notEmpty(ifNull(p.brand, ''))");
  predicates.push(`notEmpty(ifNull(${smartCategory()}, ''))`);
  return clickHouseQuery<GapRow>(`
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
      HAVING products >= 2 AND median_price > 0
    )
    GROUP BY brand, category
    HAVING retailers >= 2 AND high_price > low_price
    ORDER BY gap_pct DESC, products DESC
    LIMIT 8
  `, params, 9_000);
}

async function promotions(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = {};
  const predicates = currentPredicates(access, params, filters);
  predicates.push("toFloat64(ifNull(s.regular_price, 0)) > 0");
  predicates.push(`toFloat64(s.regular_price) > ${CURRENT_PRICE}`);
  return clickHouseQuery<PromotionRow>(`
    SELECT
      p.name,
      p.brand,
      ${smartCategory()} AS category,
      p.supermarket AS retailer,
      toFloat64(s.regular_price) AS regular_price,
      ${CURRENT_PRICE} AS offer_price,
      round((toFloat64(s.regular_price) - ${CURRENT_PRICE}) / toFloat64(s.regular_price) * 100, 1) AS discount_pct,
      toString(s.observed_at) AS observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY discount_pct DESC, s.observed_at DESC
    LIMIT 6
  `, params, 8_000);
}

async function changes(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyRequested(predicates, params, filters);
  predicates.push("d.effective_price > 0");
  return clickHouseQuery<ChangeRow>(`
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
      observed_at,
      count() OVER () AS total_changes
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
    LIMIT 8
  `, params, 9_000);
}

async function options(access: ScopedAccess, filters: DashboardFilters) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  applyRequested(predicates, params, filters, "p", { retailer: true, category: false, brand: false });
  return clickHouseQuery<OptionRow>(`
    SELECT dimension, value, products
    FROM (
      SELECT 'category' AS dimension, value, products
      FROM (
        SELECT ${smartCategory()} AS value, uniqExact(p.id) AS products
        FROM products AS p FINAL
        WHERE ${predicates.join("\n          AND ")}
          AND notEmpty(ifNull(${smartCategory()}, ''))
        GROUP BY value
        ORDER BY products DESC
        LIMIT 80
      )
      UNION ALL
      SELECT 'brand' AS dimension, value, products
      FROM (
        SELECT ifNull(p.brand, '') AS value, uniqExact(p.id) AS products
        FROM products AS p FINAL
        WHERE ${predicates.join("\n          AND ")}
          AND notEmpty(ifNull(p.brand, ''))
        GROUP BY value
        ORDER BY products DESC
        LIMIT 80
      )
    )
    ORDER BY dimension ASC, products DESC
  `, params, 7_000);
}

function number(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function clickHouseDashboard(accessInput: EnterpriseAccessContext, filtersInput: DashboardFilters) {
  const access = accessInput as ScopedAccess;
  const filters: DashboardFilters = {
    retailer: clean(filtersInput.retailer, 100) || null,
    category: clean(filtersInput.category, 180) || null,
    brand: clean(filtersInput.brand, 180) || null,
    days: days(filtersInput.days),
  };

  const [summaryRow, trendRows, retailerRows, gapRows, promotionRows, changeRows, optionRows] = await Promise.all([
    summary(access, filters),
    trend(access, filters),
    retailerBreakdown(access, filters),
    gaps(access, filters),
    promotions(access, filters),
    changes(access, filters),
    options(access, filters),
  ]);

  const previousTrend = trendRows.at(-2);
  const latestTrend = trendRows.at(-1);
  const previousMedian = number(previousTrend?.median_price);
  const latestMedian = number(latestTrend?.median_price);
  const medianVariationPct = previousMedian > 0 && latestMedian > 0
    ? Math.round((latestMedian / previousMedian - 1) * 1000) / 10
    : null;
  const totalChanges = number(changeRows[0]?.total_changes);

  return {
    source: "clickhouse" as const,
    generatedAt: new Date().toISOString(),
    filters,
    kpis: {
      monitoredProducts: number(summaryRow?.monitored_products),
      retailers: number(summaryRow?.retailers),
      averagePrice: number(summaryRow?.average_price),
      medianPrice: number(summaryRow?.median_price),
      medianVariationPct,
      inStockProducts: number(summaryRow?.in_stock_products),
      availabilityPct: number(summaryRow?.availability_pct),
      promotions: number(summaryRow?.promotions),
      promotionPct: number(summaryRow?.promotion_pct),
      priceChangesToday: totalChanges,
      lastObservedAt: summaryRow?.last_observed_at ?? null,
    },
    trend: trendRows.map((row) => ({
      date: row.date,
      averagePrice: number(row.average_price),
      medianPrice: number(row.median_price),
      products: number(row.products),
    })),
    retailers: retailerRows.map((row) => ({
      retailer: row.retailer,
      products: number(row.products),
      inStock: number(row.in_stock),
      availabilityPct: number(row.availability_pct),
      averagePrice: number(row.average_price),
      medianPrice: number(row.median_price),
      promotions: number(row.promotions),
      promotionPct: number(row.promotion_pct),
      lastObservedAt: row.last_observed_at,
    })),
    gaps: gapRows.map((row) => ({
      brand: row.brand,
      category: row.category,
      retailers: number(row.retailers),
      products: number(row.products),
      lowRetailer: row.low_retailer,
      highRetailer: row.high_retailer,
      lowPrice: number(row.low_price),
      highPrice: number(row.high_price),
      gapPct: number(row.gap_pct),
    })),
    promotions: promotionRows.map((row) => ({
      name: row.name,
      brand: row.brand,
      category: row.category,
      retailer: row.retailer,
      regularPrice: number(row.regular_price),
      offerPrice: number(row.offer_price),
      discountPct: number(row.discount_pct),
      observedAt: row.observed_at,
    })),
    changes: changeRows.map((row) => ({
      name: row.name,
      brand: row.brand,
      retailer: row.retailer,
      previousPrice: number(row.previous_price),
      currentPrice: number(row.current_price),
      changePct: number(row.change_pct),
      observedAt: row.observed_at,
    })),
    options: {
      categories: optionRows.filter((row) => row.dimension === "category").map((row) => ({ value: row.value, products: number(row.products) })),
      brands: optionRows.filter((row) => row.dimension === "brand").map((row) => ({ value: row.value, products: number(row.products) })),
    },
    semantics: {
      headlinePrice: "median_current_price",
      trendPrice: "daily_median_price",
      gaps: "brand_category_median_between_retailers",
      currentDayMayBePartial: true,
    },
  };
}
