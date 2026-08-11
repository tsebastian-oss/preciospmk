import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

type ScopedAccess = EnterpriseAccessContext & {
  industryConfigured?: boolean;
  industrySlug?: string | null;
};

type CategoryFilters = {
  category?: string | null;
  retailer?: string | null;
  days?: number;
};

type Numeric = number | string;

type CategoryOptionRow = { category: string; products: Numeric };
type SummaryRow = {
  products: Numeric;
  brands: Numeric;
  retailers: Numeric;
  average_price: Numeric;
  median_price: Numeric;
  in_stock: Numeric;
  availability_pct: Numeric;
  promotions: Numeric;
  promotion_pct: Numeric;
  last_observed_at: string | null;
};
type TrendRow = { date: string; retailer: string; median_price: Numeric; average_price: Numeric; products: Numeric };
type BrandRow = {
  brand: string;
  products: Numeric;
  retailers: Numeric;
  median_price: Numeric;
  average_price: Numeric;
  availability_pct: Numeric;
  promotions: Numeric;
  promotion_pct: Numeric;
};
type RetailerRow = {
  retailer: string;
  products: Numeric;
  brands: Numeric;
  median_price: Numeric;
  average_price: Numeric;
  availability_pct: Numeric;
  promotions: Numeric;
  promotion_pct: Numeric;
};
type MatrixRow = { brand: string; retailer: string; products: Numeric; median_price: Numeric; promotion_pct: Numeric; availability_pct: Numeric };
type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  retailer: string;
  price: Numeric;
  regular_price: Numeric;
  offer_price: Numeric;
  discount_pct: Numeric;
  in_stock: boolean;
  observed_at: string | null;
};

const CURRENT_PRICE = "if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0)))";

function smartCategory(alias = "p") {
  return `coalesce(nullIf(trimBoth(${alias}.smart_category), ''), nullIf(trimBoth(${alias}.category), ''))`;
}

function clean(value: string | null | undefined, max = 180) {
  return (value ?? "").trim().slice(0, max);
}

function safeDays(value: number | undefined) {
  return [7, 30, 90].includes(Number(value)) ? Number(value) : 30;
}

function number(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function scopePredicates(access: ScopedAccess, params: ClickHouseParams, alias = "p") {
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

function categoryPredicates(access: ScopedAccess, params: ClickHouseParams, category: string, retailer: string | null, alias = "p") {
  const predicates = scopePredicates(access, params, alias);
  predicates.push(`${smartCategory(alias)} = ${addString(params, "requested_category", category)}`);
  if (retailer) predicates.push(`${alias}.supermarket = ${addString(params, "requested_retailer", retailer)}`);
  return predicates;
}

async function categoryOptions(access: ScopedAccess) {
  const params: ClickHouseParams = {};
  const predicates = scopePredicates(access, params);
  return clickHouseQuery<CategoryOptionRow>(`
    SELECT ${smartCategory()} AS category, uniqExact(p.id) AS products
    FROM products AS p FINAL
    WHERE ${predicates.join("\n      AND ")}
      AND notEmpty(ifNull(${smartCategory()}, ''))
    GROUP BY category
    ORDER BY products DESC, category ASC
    LIMIT 120
  `, params, 7_000);
}

async function summary(access: ScopedAccess, category: string, retailer: string | null) {
  const params: ClickHouseParams = {};
  const predicates = categoryPredicates(access, params, category, retailer);
  predicates.push(`${CURRENT_PRICE} > 0`);
  const rows = await clickHouseQuery<SummaryRow>(`
    SELECT
      uniqExact(p.id) AS products,
      uniqExactIf(p.brand, notEmpty(ifNull(p.brand, ''))) AS brands,
      uniqExact(p.supermarket) AS retailers,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      countIf(s.in_stock) AS in_stock,
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

async function trend(access: ScopedAccess, category: string, retailer: string | null, days: number) {
  const params: ClickHouseParams = { days_back: { type: "UInt16", value: days - 1 } };
  const predicates = categoryPredicates(access, params, category, retailer);
  predicates.push("d.effective_price > 0");
  predicates.push("d.price_date >= subtractDays(toDate(now(), 'America/Santiago'), {days_back:UInt16})");
  return clickHouseQuery<TrendRow>(`
    SELECT date, retailer, median_price, average_price, products
    FROM (
      SELECT
        toString(d.price_date) AS date,
        p.supermarket AS retailer,
        round(quantileTDigest(0.5)(toFloat64(d.effective_price)), 0) AS median_price,
        round(avg(toFloat64(d.effective_price)), 0) AS average_price,
        uniqExact(d.product_id) AS products
      FROM daily_pricing_live AS d FINAL
      INNER JOIN products AS p FINAL ON p.id = d.product_id
      WHERE ${predicates.join("\n        AND ")}
      GROUP BY d.price_date, p.supermarket

      UNION ALL

      SELECT
        toString(d.price_date) AS date,
        '__ALL__' AS retailer,
        round(quantileTDigest(0.5)(toFloat64(d.effective_price)), 0) AS median_price,
        round(avg(toFloat64(d.effective_price)), 0) AS average_price,
        uniqExact(d.product_id) AS products
      FROM daily_pricing_live AS d FINAL
      INNER JOIN products AS p FINAL ON p.id = d.product_id
      WHERE ${predicates.join("\n        AND ")}
      GROUP BY d.price_date
    )
    ORDER BY date ASC, retailer ASC
  `, params, 9_000);
}

async function brands(access: ScopedAccess, category: string, retailer: string | null) {
  const params: ClickHouseParams = {};
  const predicates = categoryPredicates(access, params, category, retailer);
  predicates.push(`${CURRENT_PRICE} > 0`);
  predicates.push("notEmpty(ifNull(p.brand, ''))");
  return clickHouseQuery<BrandRow>(`
    SELECT
      ifNull(p.brand, '') AS brand,
      uniqExact(p.id) AS products,
      uniqExact(p.supermarket) AS retailers,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY brand
    ORDER BY products DESC, brand ASC
    LIMIT 20
  `, params, 8_000);
}

async function retailers(access: ScopedAccess, category: string, retailer: string | null) {
  const params: ClickHouseParams = {};
  const predicates = categoryPredicates(access, params, category, retailer);
  predicates.push(`${CURRENT_PRICE} > 0`);
  return clickHouseQuery<RetailerRow>(`
    SELECT
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      uniqExactIf(p.brand, notEmpty(ifNull(p.brand, ''))) AS brands,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      round(avg(${CURRENT_PRICE}), 0) AS average_price,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct,
      countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) AS promotions,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.supermarket
    ORDER BY products DESC, retailer ASC
  `, params, 8_000);
}

async function matrix(access: ScopedAccess, category: string, retailer: string | null, topBrands: string[]) {
  if (!topBrands.length) return [] as MatrixRow[];
  const params: ClickHouseParams = {};
  const predicates = categoryPredicates(access, params, category, retailer);
  addStringList(predicates, params, "p.brand", topBrands, "matrix_brand");
  predicates.push(`${CURRENT_PRICE} > 0`);
  return clickHouseQuery<MatrixRow>(`
    SELECT
      ifNull(p.brand, '') AS brand,
      p.supermarket AS retailer,
      uniqExact(p.id) AS products,
      round(quantileTDigest(0.5)(${CURRENT_PRICE}), 0) AS median_price,
      round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE}) / greatest(count(), 1) * 100, 1) AS promotion_pct,
      round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS availability_pct
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY brand, p.supermarket
    ORDER BY brand ASC, retailer ASC
  `, params, 8_000);
}

async function products(access: ScopedAccess, category: string, retailer: string | null) {
  const params: ClickHouseParams = {};
  const predicates = categoryPredicates(access, params, category, retailer);
  predicates.push(`${CURRENT_PRICE} > 0`);
  return clickHouseQuery<ProductRow>(`
    SELECT
      toString(p.id) AS id,
      p.name,
      p.brand,
      p.supermarket AS retailer,
      ${CURRENT_PRICE} AS price,
      toFloat64(ifNull(s.regular_price, 0)) AS regular_price,
      toFloat64(ifNull(s.offer_price, 0)) AS offer_price,
      if(toFloat64(ifNull(s.regular_price, 0)) > ${CURRENT_PRICE} AND toFloat64(ifNull(s.regular_price, 0)) > 0,
        round((toFloat64(s.regular_price) - ${CURRENT_PRICE}) / toFloat64(s.regular_price) * 100, 1), 0) AS discount_pct,
      s.in_stock,
      toString(s.observed_at) AS observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY s.observed_at DESC, price ASC
    LIMIT 80
  `, params, 8_000);
}

export async function clickHouseCategoryIntelligence(accessInput: EnterpriseAccessContext, filtersInput: CategoryFilters) {
  const access = accessInput as ScopedAccess;
  const optionsRows = await categoryOptions(access);
  const requestedCategory = clean(filtersInput.category, 180);
  const selectedCategory = requestedCategory || optionsRows[0]?.category || "";
  const retailer = clean(filtersInput.retailer, 100) || null;
  const days = safeDays(filtersInput.days);

  if (!selectedCategory) {
    return {
      source: "clickhouse" as const,
      generatedAt: new Date().toISOString(),
      selectedCategory: null,
      categories: [],
      kpis: null,
      trend: [],
      brands: [],
      retailers: [],
      matrix: [],
      products: [],
      insights: ["No hay categorías disponibles dentro del alcance contratado."],
    };
  }

  const [summaryRow, trendRows, brandRows, retailerRows, productRows] = await Promise.all([
    summary(access, selectedCategory, retailer),
    trend(access, selectedCategory, retailer, days),
    brands(access, selectedCategory, retailer),
    retailers(access, selectedCategory, retailer),
    products(access, selectedCategory, retailer),
  ]);

  const topBrands = brandRows.slice(0, 8).map((row) => row.brand);
  const matrixRows = await matrix(access, selectedCategory, retailer, topBrands);

  const overallTrend = trendRows.filter((row) => row.retailer === "__ALL__");
  const firstMedian = number(overallTrend[0]?.median_price);
  const lastMedian = number(overallTrend.at(-1)?.median_price);
  const variationPct = firstMedian > 0 && lastMedian > 0 ? Math.round((lastMedian / firstMedian - 1) * 1000) / 10 : null;
  const categoryMedian = number(summaryRow?.median_price);
  const retailerMapped = retailerRows.map((row) => ({
    retailer: row.retailer,
    products: number(row.products),
    brands: number(row.brands),
    medianPrice: number(row.median_price),
    averagePrice: number(row.average_price),
    priceIndex: categoryMedian > 0 ? Math.round(number(row.median_price) / categoryMedian * 1000) / 10 : 100,
    availabilityPct: number(row.availability_pct),
    promotions: number(row.promotions),
    promotionPct: number(row.promotion_pct),
  }));
  const brandTotal = brandRows.reduce((sum, row) => sum + number(row.products), 0);
  const brandMapped = brandRows.map((row) => ({
    brand: row.brand,
    products: number(row.products),
    assortmentSharePct: brandTotal > 0 ? Math.round(number(row.products) / brandTotal * 1000) / 10 : 0,
    retailers: number(row.retailers),
    medianPrice: number(row.median_price),
    averagePrice: number(row.average_price),
    availabilityPct: number(row.availability_pct),
    promotions: number(row.promotions),
    promotionPct: number(row.promotion_pct),
  }));

  const cheapest = [...retailerMapped].filter((row) => row.medianPrice > 0).sort((a, b) => a.medianPrice - b.medianPrice)[0];
  const priciest = [...retailerMapped].filter((row) => row.medianPrice > 0).sort((a, b) => b.medianPrice - a.medianPrice)[0];
  const promoLeader = [...retailerMapped].sort((a, b) => b.promotionPct - a.promotionPct)[0];
  const assortmentLeader = brandMapped[0];
  const insights: string[] = [];
  if (variationPct !== null) insights.push(`El precio mediano de ${selectedCategory} ${variationPct >= 0 ? "subió" : "bajó"} ${Math.abs(variationPct).toFixed(1)}% en los últimos ${days} días.`);
  if (cheapest && priciest && cheapest.retailer !== priciest.retailer && cheapest.medianPrice > 0) {
    const gap = (priciest.medianPrice / cheapest.medianPrice - 1) * 100;
    insights.push(`${cheapest.retailer} presenta la mediana más baja; ${priciest.retailer} está ${gap.toFixed(1)}% por encima dentro de la categoría.`);
  }
  if (assortmentLeader) insights.push(`${assortmentLeader.brand} lidera la presencia de surtido observado con ${assortmentLeader.assortmentSharePct.toFixed(1)}% de los SKU con marca.`);
  if (promoLeader && promoLeader.promotionPct > 0) insights.push(`${promoLeader.retailer} muestra la mayor intensidad promocional: ${promoLeader.promotionPct.toFixed(1)}% de sus SKU están en oferta.`);
  if (summaryRow && number(summaryRow.availability_pct) < 85) insights.push(`La disponibilidad de la categoría es ${number(summaryRow.availability_pct).toFixed(1)}%; conviene revisar quiebres por retailer y marca.`);
  if (!insights.length) insights.push("La categoría se mantiene estable con la cobertura disponible en ClickHouse.");

  return {
    source: "clickhouse" as const,
    generatedAt: new Date().toISOString(),
    selectedCategory,
    filters: { retailer, days },
    categories: optionsRows.map((row) => ({ value: row.category, products: number(row.products) })),
    kpis: summaryRow ? {
      products: number(summaryRow.products),
      brands: number(summaryRow.brands),
      retailers: number(summaryRow.retailers),
      averagePrice: number(summaryRow.average_price),
      medianPrice: categoryMedian,
      variationPct,
      availabilityPct: number(summaryRow.availability_pct),
      promotions: number(summaryRow.promotions),
      promotionPct: number(summaryRow.promotion_pct),
      lastObservedAt: summaryRow.last_observed_at,
    } : null,
    trend: trendRows.map((row) => ({
      date: row.date,
      retailer: row.retailer,
      medianPrice: number(row.median_price),
      averagePrice: number(row.average_price),
      products: number(row.products),
    })),
    brands: brandMapped,
    retailers: retailerMapped,
    matrix: matrixRows.map((row) => ({
      brand: row.brand,
      retailer: row.retailer,
      products: number(row.products),
      medianPrice: number(row.median_price),
      promotionPct: number(row.promotion_pct),
      availabilityPct: number(row.availability_pct),
    })),
    products: productRows.map((row) => ({
      id: row.id,
      name: row.name,
      brand: row.brand,
      retailer: row.retailer,
      price: number(row.price),
      regularPrice: number(row.regular_price),
      offerPrice: number(row.offer_price),
      discountPct: number(row.discount_pct),
      inStock: Boolean(row.in_stock),
      observedAt: row.observed_at,
    })),
    insights: insights.slice(0, 5),
    semantics: {
      assortmentShare: "share_of_observed_skus_not_sales_market_share",
      headlinePrice: "median_current_price",
      trendPrice: "daily_median_price",
      source: "clickhouse_only",
    },
  };
}
