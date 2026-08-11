import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export type ClickHouseBrandProduct = {
  id: string;
  supermarket: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | string | null;
  offer_price: number | string | null;
  unit: string | null;
  unit_price: number | string | null;
  in_stock: boolean;
  observed_at: string;
  savings: number | string | null;
  discount_pct: number | string | null;
};

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

function addIndustryScope(predicates: string[], params: ClickHouseParams, access: EnterpriseAccessContext) {
  if (!access.industryConfigured || !access.industrySlug || access.industrySlug === "all") return;
  if (access.industrySlug === "grocery") {
    predicates.push("p.retailer_type = 'supermarket'");
    return;
  }
  predicates.push(`p.industry_slug = ${addString(params, "scope_industry", access.industrySlug)}`);
}

function basePredicates(
  access: EnterpriseAccessContext,
  params: ClickHouseParams,
  includeBrandScope: boolean,
) {
  const predicates = [
    "p.retailer_type IN ('supermarket', 'department_store', 'pharmacy', 'home_improvement')",
    "(toFloat64(ifNull(s.offer_price, 0)) > 0 OR toFloat64(ifNull(s.regular_price, 0)) > 0)",
  ];
  addStringList(predicates, params, "p.supermarket", access.retailers, "scope_retailer");
  addStringList(predicates, params, "p.category", access.categories, "scope_category");
  if (includeBrandScope) addStringList(predicates, params, "p.brand", access.brands, "scope_brand");
  addIndustryScope(predicates, params, access);
  return predicates;
}

function productSelect(whereSql: string, limit: number) {
  return `
    SELECT
      toString(p.id) AS id,
      p.supermarket,
      p.external_id,
      p.name,
      p.brand,
      p.category,
      p.url,
      p.image_url,
      if(
        toFloat64(ifNull(s.regular_price, 0)) > 0,
        toFloat64(s.regular_price),
        NULL
      ) AS regular_price,
      if(
        toFloat64(ifNull(s.offer_price, 0)) > 0,
        toFloat64(s.offer_price),
        toFloat64(ifNull(s.regular_price, 0))
      ) AS offer_price,
      s.unit,
      if(s.unit_price IS NULL, NULL, toFloat64(s.unit_price)) AS unit_price,
      s.in_stock,
      concat(formatDateTime(s.observed_at, '%Y-%m-%dT%H:%i:%s', 'UTC'), 'Z') AS observed_at,
      greatest(
        toFloat64(ifNull(s.regular_price, 0)) - if(
          toFloat64(ifNull(s.offer_price, 0)) > 0,
          toFloat64(s.offer_price),
          toFloat64(ifNull(s.regular_price, 0))
        ),
        0
      ) AS savings,
      if(
        toFloat64(ifNull(s.regular_price, 0)) > 0
          AND toFloat64(ifNull(s.regular_price, 0)) > if(
            toFloat64(ifNull(s.offer_price, 0)) > 0,
            toFloat64(s.offer_price),
            toFloat64(ifNull(s.regular_price, 0))
          ),
        round(
          (
            toFloat64(s.regular_price) - if(
              toFloat64(ifNull(s.offer_price, 0)) > 0,
              toFloat64(s.offer_price),
              toFloat64(s.regular_price)
            )
          ) / toFloat64(s.regular_price) * 100,
          1
        ),
        0
      ) AS discount_pct
    FROM product_latest_price_state AS s FINAL
    INNER JOIN products AS p FINAL ON p.id = s.product_id
    WHERE ${whereSql}
    ORDER BY s.in_stock DESC, s.observed_at DESC
    LIMIT ${limit}
  `;
}

export async function searchBrandProductsFromClickHouse(
  term: string,
  access: EnterpriseAccessContext,
): Promise<ClickHouseBrandProduct[]> {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params, true);
  const termParam = addString(params, "brand_search", term);
  predicates.push(`(
    positionCaseInsensitiveUTF8(ifNull(p.brand, ''), ${termParam}) > 0
    OR positionCaseInsensitiveUTF8(p.name, ${termParam}) > 0
  )`);

  return clickHouseQuery<ClickHouseBrandProduct>(
    productSelect(predicates.join("\n      AND "), 1000),
    params,
    7_000,
  );
}

export async function brandCategoryPoolFromClickHouse(
  categoryToken: string,
  selectedBrand: string,
  access: EnterpriseAccessContext,
): Promise<ClickHouseBrandProduct[]> {
  const params: ClickHouseParams = {};
  const predicates = basePredicates(access, params, false);
  const categoryParam = addString(params, "category_token", categoryToken);
  predicates.push(`positionCaseInsensitiveUTF8(ifNull(p.category, ''), ${categoryParam}) > 0`);

  if (!access.isSaasAdmin && access.competitors.length > 0) {
    addStringList(
      predicates,
      params,
      "p.brand",
      [...new Set([selectedBrand, ...access.competitors])],
      "competitor_brand",
    );
  }

  return clickHouseQuery<ClickHouseBrandProduct>(
    productSelect(predicates.join("\n      AND "), 2000),
    params,
    7_000,
  );
}
