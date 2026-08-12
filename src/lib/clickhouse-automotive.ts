import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

type Numeric = string | number;

type AutomotiveOptionRow = {
  brand: string;
  model: string;
  dealer: string;
  versions: Numeric;
};

type AutomotiveVehicleRow = {
  id: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  body_type: string;
  image_url: string | null;
  url: string;
  list_price: Numeric;
  brand_bonus: Numeric;
  online_bonus: Numeric;
  dealer_bonus: Numeric;
  cash_price: Numeric;
  finance_bonus: Numeric;
  final_price: Numeric;
  fuel_type: string;
  technical_sheet_url: string;
  observed_at: string | null;
};

type AutomotiveSummaryRow = {
  brands: Numeric;
  models: Numeric;
  versions: Numeric;
  dealers: Numeric;
  last_observed_at: string | null;
};

type ScopedAccess = EnterpriseAccessContext & { brands?: string[] };

function number(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: string | null | undefined, max = 180) {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function addString(params: ClickHouseParams, name: string, value: string) {
  params[name] = { type: "String", value };
  return `{${name}:String}`;
}

function metadataString(key: string) {
  return `JSONExtractString(toString(p.source_metadata), '${key}')`;
}

function metadataNumber(key: string) {
  return `toFloat64OrZero(toString(JSONExtractRaw(toString(p.source_metadata), '${key}')))`;
}

function autoPredicates(access: ScopedAccess, params: ClickHouseParams) {
  const predicates = ["p.retailer_type = 'automotive'", "p.industry_slug = 'automotive'"];
  const allowedBrands = [...new Set((access.brands ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 100);
  if (allowedBrands.length) {
    const placeholders = allowedBrands.map((brand, index) => addString(params, `scope_brand_${index}`, brand));
    predicates.push(`p.brand IN (${placeholders.join(", ")})`);
  }
  return predicates;
}

export async function clickHouseAutomotiveOptions(accessInput: EnterpriseAccessContext) {
  const access = accessInput as ScopedAccess;
  const params: ClickHouseParams = {};
  const predicates = autoPredicates(access, params);
  const rows = await clickHouseQuery<AutomotiveOptionRow>(`
    SELECT
      ifNull(p.brand, '') AS brand,
      coalesce(nullIf(${metadataString("model")}, ''), nullIf(p.parent_external_id, ''), p.name) AS model,
      p.supermarket AS dealer,
      uniqExact(p.id) AS versions
    FROM products AS p FINAL
    WHERE ${predicates.join("\n      AND ")}
      AND notEmpty(ifNull(p.brand, ''))
    GROUP BY brand, model, dealer
    ORDER BY brand ASC, model ASC, dealer ASC
    LIMIT 5000
  `, params, 6_000);

  const brands = [...new Set(rows.map((row) => row.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const models = [...new Set(rows.map((row) => `${row.brand}\u0000${row.model}`))]
    .map((value) => { const [brand, model] = value.split("\u0000"); return { brand, model }; })
    .sort((a, b) => a.brand.localeCompare(b.brand, "es") || a.model.localeCompare(b.model, "es"));
  const dealers = [...new Set(rows.map((row) => row.dealer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return { brands, models, dealers };
}

export async function clickHouseAutomotiveCatalog(
  accessInput: EnterpriseAccessContext,
  filters: { brand?: string | null; model?: string | null; dealer?: string | null },
) {
  const access = accessInput as ScopedAccess;
  const params: ClickHouseParams = {};
  const predicates = autoPredicates(access, params);
  const brand = clean(filters.brand);
  const model = clean(filters.model, 220);
  const dealer = clean(filters.dealer);
  if (brand) predicates.push(`p.brand = ${addString(params, "requested_brand", brand)}`);
  if (model) predicates.push(`coalesce(nullIf(${metadataString("model")}, ''), p.parent_external_id, p.name) = ${addString(params, "requested_model", model)}`);
  if (dealer) predicates.push(`p.supermarket = ${addString(params, "requested_dealer", dealer)}`);

  const rows = await clickHouseQuery<AutomotiveVehicleRow>(`
    SELECT
      toString(p.id) AS id,
      ifNull(p.brand, '') AS brand,
      coalesce(nullIf(${metadataString("model")}, ''), nullIf(p.parent_external_id, ''), p.name) AS model,
      coalesce(nullIf(p.variant, ''), nullIf(${metadataString("version")}, ''), 'Versión no informada') AS version,
      p.supermarket AS dealer,
      coalesce(nullIf(p.smart_category, ''), nullIf(p.category, ''), 'Vehículo') AS body_type,
      p.image_url AS image_url,
      p.url AS url,
      if(${metadataNumber("list_price")} > 0, ${metadataNumber("list_price")}, toFloat64(ifNull(s.regular_price, 0))) AS list_price,
      ${metadataNumber("brand_bonus")} AS brand_bonus,
      ${metadataNumber("online_bonus")} AS online_bonus,
      ${metadataNumber("dealer_bonus")} AS dealer_bonus,
      if(${metadataNumber("cash_price")} > 0, ${metadataNumber("cash_price")}, toFloat64(ifNull(s.regular_price, 0))) AS cash_price,
      ${metadataNumber("finance_bonus")} AS finance_bonus,
      if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), ${metadataNumber("final_price")}) AS final_price,
      ${metadataString("fuel_type")} AS fuel_type,
      ${metadataString("technical_sheet_url")} AS technical_sheet_url,
      toString(s.observed_at) AS observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY final_price ASC, brand ASC, model ASC, version ASC, dealer ASC
    LIMIT 1000
  `, params, 8_000);

  const summaryRows = await clickHouseQuery<AutomotiveSummaryRow>(`
    SELECT
      uniqExact(p.brand) AS brands,
      uniqExact(coalesce(nullIf(${metadataString("model")}, ''), p.parent_external_id, p.name)) AS models,
      uniqExact(p.id) AS versions,
      uniqExact(p.supermarket) AS dealers,
      toString(max(s.observed_at)) AS last_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${autoPredicates(access, {}).join(" AND ")}
  `, {}, 6_000).catch(() => [] as AutomotiveSummaryRow[]);

  const summary = summaryRows[0] ?? { brands: 0, models: 0, versions: 0, dealers: 0, last_observed_at: null };
  return {
    source: "clickhouse" as const,
    summary: {
      brands: number(summary.brands),
      models: number(summary.models),
      versions: number(summary.versions),
      dealers: number(summary.dealers),
      lastObservedAt: summary.last_observed_at,
    },
    vehicles: rows.map((row) => ({
      id: row.id,
      brand: row.brand,
      model: row.model,
      version: row.version,
      dealer: row.dealer,
      bodyType: row.body_type,
      imageUrl: row.image_url,
      url: row.url,
      listPrice: number(row.list_price),
      brandBonus: number(row.brand_bonus),
      onlineBonus: number(row.online_bonus),
      dealerBonus: number(row.dealer_bonus),
      cashPrice: number(row.cash_price),
      financeBonus: number(row.finance_bonus),
      finalPrice: number(row.final_price),
      fuelType: row.fuel_type || null,
      technicalSheetUrl: row.technical_sheet_url || null,
      observedAt: row.observed_at,
    })),
  };
}
