import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

type ScopedAccess = EnterpriseAccessContext & {
  industryConfigured?: boolean;
  industrySlug?: string | null;
};

type Numeric = number | string;

type BrandRow = { value: string; products: Numeric };
type ProductRow = {
  id: string;
  name: string;
  brand: string;
  retailer: string;
  latest_price: Numeric;
  last_observed_at: string | null;
};
type TrendRow = {
  id: string;
  name: string;
  brand: string;
  retailer: string;
  date: string;
  price: Numeric;
};

export type ProductTrendSelection = {
  id: string;
  name: string;
  brand: string;
  retailer: string;
  latestPrice: number;
  lastObservedAt: string | null;
};

export type ProductTrendSeries = ProductTrendSelection & {
  points: Array<{ date: string; price: number }>;
};

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

function smartCategory(alias = "p") {
  return `coalesce(nullIf(trimBoth(${alias}.smart_category), ''), nullIf(trimBoth(${alias}.category), ''))`;
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

function numeric(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function productTrendBrands(access: ScopedAccess) {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  predicates.push("notEmpty(ifNull(p.brand, ''))");
  predicates.push("d.effective_price > 0");
  const rows = await clickHouseQuery<BrandRow>(`
    SELECT ifNull(p.brand, '') AS value, uniqExact(p.id) AS products
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY value
    ORDER BY products DESC, value ASC
    LIMIT 250
  `, params, 8_000);
  return rows.map((row) => ({ value: row.value, products: numeric(row.products) }));
}

export async function productTrendProducts(access: ScopedAccess, brand: string) {
  const selectedBrand = brand.trim().slice(0, 180);
  if (!selectedBrand) return [];
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params);
  predicates.push(`p.brand = ${addString(params, "requested_brand", selectedBrand)}`);
  predicates.push("d.effective_price > 0");
  const rows = await clickHouseQuery<ProductRow>(`
    SELECT
      toString(p.id) AS id,
      p.name AS name,
      ifNull(p.brand, '') AS brand,
      p.supermarket AS retailer,
      argMax(toFloat64(d.effective_price), d.observed_at) AS latest_price,
      toString(max(d.observed_at)) AS last_observed_at
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.id, p.name, brand, retailer
    ORDER BY last_observed_at DESC, name ASC
    LIMIT 500
  `, params, 9_000);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    retailer: row.retailer,
    latestPrice: numeric(row.latest_price),
    lastObservedAt: row.last_observed_at,
  }));
}

export async function productTrendSeries(access: ScopedAccess, productIds: string[], requestedDays: number) {
  const ids = [...new Set(productIds.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
  if (!ids.length) return [];
  const days = [7, 30, 90].includes(Number(requestedDays)) ? Number(requestedDays) : 30;
  const params: ClickHouseParams = {
    days_back: { type: "UInt16", value: days - 1 },
  };
  const predicates = basePredicates(access, params);
  const placeholders = ids.map((id, index) => addString(params, `product_${index}`, id));
  predicates.push(`toString(p.id) IN (${placeholders.join(", ")})`);
  predicates.push("d.effective_price > 0");
  predicates.push("d.price_date >= subtractDays(toDate(now(), 'America/Santiago'), {days_back:UInt16})");
  const rows = await clickHouseQuery<TrendRow>(`
    SELECT
      toString(p.id) AS id,
      p.name AS name,
      ifNull(p.brand, '') AS brand,
      p.supermarket AS retailer,
      toString(d.price_date) AS date,
      round(quantileTDigest(0.5)(toFloat64(d.effective_price)), 0) AS price
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.id, p.name, brand, retailer, d.price_date
    ORDER BY id ASC, d.price_date ASC
  `, params, 9_000);

  const map = new Map<string, ProductTrendSeries>();
  for (const row of rows) {
    const existing = map.get(row.id) ?? {
      id: row.id,
      name: row.name,
      brand: row.brand,
      retailer: row.retailer,
      latestPrice: 0,
      lastObservedAt: null,
      points: [],
    };
    const price = numeric(row.price);
    existing.points.push({ date: row.date, price });
    existing.latestPrice = price;
    existing.lastObservedAt = row.date;
    map.set(row.id, existing);
  }

  return ids.map((id) => map.get(id)).filter((item): item is ProductTrendSeries => Boolean(item));
}
