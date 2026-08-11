import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export type DailyPricingPayload = {
  series: Array<{
    id: string;
    label: string;
    dimension: "category" | "brand";
    kind: "group" | "smart" | "brand";
    points: Array<{ date: string; price: number | null; skus: number | null }>;
  }>;
  selectedSeries: string[];
  daysRequested: number;
  availableDays: number;
  firstDate: string | null;
  lastDate: string | null;
  refreshedAt: string | null;
  latestObservationAt: string | null;
  partialDay: boolean;
  live: boolean;
  pollingSeconds: number;
  historicalDaysFrozen: boolean;
  currentDayObservations: number;
  previousDayObservations: number;
  currentDayCoveragePct: number | null;
  method: string;
  trimLowerPct: number;
  trimUpperPct: number;
  minimumPresencePct: number;
  currency: string;
  maxSeries: number;
  cacheHit?: boolean;
  temporarilyUnavailable?: boolean;
  dataSource?: "clickhouse" | "supabase";
};

type SeriesDefinition = {
  id: string;
  label: string;
  dimension: "category" | "brand";
  kind: "group" | "smart" | "brand";
  filterColumn: "category_group" | "smart_category" | "brand";
  filterValue: string;
};

type DailyRow = {
  series_index: number | string;
  date: string;
  price: number | string | null;
  skus: number | string | null;
};

type SummaryRow = {
  available_days: number | string;
  first_date: string | null;
  last_date: string | null;
  refreshed_at: string | null;
  today_count: number | string;
  previous_count: number | string;
  partial_day: boolean | number | string;
};

const TODAY_SANTIAGO = "toDate(now(), 'America/Santiago')";
const SMART_CATEGORY = "coalesce(nullIf(trimBoth(p.smart_category), ''), nullIf(trimBoth(d.category), ''))";

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

function sourceSql(access: EnterpriseAccessContext, days: number, params: ClickHouseParams) {
  params.days_back = { type: "UInt16", value: Math.max(0, days - 1) };
  const predicates = [
    `d.price_date >= subtractDays(${TODAY_SANTIAGO}, {days_back:UInt16})`,
    "d.effective_price > 0",
  ];

  addStringList(predicates, params, "d.supermarket", access.retailers, "scope_retailer");
  addStringList(predicates, params, "d.brand", access.brands, "scope_brand");
  addStringList(predicates, params, SMART_CATEGORY, access.categories, "scope_category");
  addIndustryScope(predicates, params, access);

  return `
    SELECT
      d.product_id,
      d.price_date,
      d.observed_at,
      d.supermarket,
      d.brand,
      d.category_group,
      ${SMART_CATEGORY} AS smart_category,
      toFloat64(d.effective_price) AS effective_price
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
  `;
}

function definitions(tokens: string[]): SeriesDefinition[] {
  const selected = tokens.length ? tokens : ["group:non_alcoholic", "group:grocery", "group:alcoholic"];
  const seen = new Set<string>();
  const result: SeriesDefinition[] = [];

  for (const token of selected) {
    const id = token.trim();
    if (!id || seen.has(id) || result.length >= 8) continue;
    const separator = id.indexOf(":");
    if (separator < 1) continue;
    const kind = id.slice(0, separator);
    const value = id.slice(separator + 1).trim();
    if (!value || !["group", "smart", "brand"].includes(kind)) continue;
    seen.add(id);

    const groupLabel = value === "non_alcoholic"
      ? "Bebidas no alcohólicas"
      : value === "grocery"
        ? "Abarrotes"
        : value === "alcoholic"
          ? "Bebidas alcohólicas"
          : value;

    result.push({
      id,
      label: kind === "group" ? groupLabel : value,
      dimension: kind === "brand" ? "brand" : "category",
      kind: kind as SeriesDefinition["kind"],
      filterColumn: kind === "group" ? "category_group" : kind === "smart" ? "smart_category" : "brand",
      filterValue: value,
    });
  }

  return result;
}

function matchedSql(source: string, series: SeriesDefinition[], params: ClickHouseParams) {
  return series.map((item, index) => {
    const placeholder = addString(params, `series_value_${index}`, item.filterValue);
    return `
      SELECT
        ${index} AS series_index,
        product_id,
        price_date,
        observed_at,
        effective_price
      FROM source
      WHERE ${item.filterColumn} = ${placeholder}
    `;
  }).join("\nUNION ALL\n");
}

function numberValue(value: number | string | boolean | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function dailyPricingTrendFromClickHouse(
  access: EnterpriseAccessContext,
  days: number,
  selectedSeries: string[],
): Promise<DailyPricingPayload> {
  const series = definitions(selectedSeries);
  const params: ClickHouseParams = {};
  const source = sourceSql(access, days, params);
  const matched = matchedSql(source, series, params);

  const dailyRows = await clickHouseQuery<DailyRow>(`
    WITH
      source AS (${source}),
      matched AS (${matched}),
      bounds AS (
        SELECT
          series_index,
          price_date,
          quantileTDigest(0.05)(effective_price) AS lower_price,
          quantileTDigest(0.95)(effective_price) AS upper_price
        FROM matched
        GROUP BY series_index, price_date
      )
    SELECT
      m.series_index,
      toString(m.price_date) AS date,
      round(
        if(
          countIf(m.effective_price BETWEEN b.lower_price AND b.upper_price) > 0,
          avgIf(m.effective_price, m.effective_price BETWEEN b.lower_price AND b.upper_price),
          avg(m.effective_price)
        ),
        0
      ) AS price,
      if(
        countIf(m.effective_price BETWEEN b.lower_price AND b.upper_price) > 0,
        countIf(m.effective_price BETWEEN b.lower_price AND b.upper_price),
        count()
      ) AS skus
    FROM matched AS m
    INNER JOIN bounds AS b
      ON b.series_index = m.series_index
      AND b.price_date = m.price_date
    GROUP BY m.series_index, m.price_date
    ORDER BY m.series_index, m.price_date
  `, params, 8_000);

  const summary = (await clickHouseQuery<SummaryRow>(`
    WITH
      source AS (${source}),
      matched AS (${matched})
    SELECT
      uniqExact(price_date) AS available_days,
      if(count() = 0, NULL, toString(min(price_date))) AS first_date,
      if(count() = 0, NULL, toString(max(price_date))) AS last_date,
      if(count() = 0, NULL, toString(max(observed_at))) AS refreshed_at,
      countIf(price_date = ${TODAY_SANTIAGO}) AS today_count,
      countIf(price_date = subtractDays(${TODAY_SANTIAGO}, 1)) AS previous_count,
      if(count() = 0, false, max(price_date) = ${TODAY_SANTIAGO}) AS partial_day
    FROM matched
  `, params, 8_000))[0];

  const pointsByIndex = new Map<number, Array<{ date: string; price: number | null; skus: number | null }>>();
  for (const row of dailyRows) {
    const index = numberValue(row.series_index);
    const points = pointsByIndex.get(index) ?? [];
    points.push({
      date: row.date,
      price: row.price === null ? null : numberValue(row.price),
      skus: row.skus === null ? null : numberValue(row.skus),
    });
    pointsByIndex.set(index, points);
  }

  const todayCount = numberValue(summary?.today_count);
  const previousCount = numberValue(summary?.previous_count);

  return {
    series: series.map((item, index) => ({
      id: item.id,
      label: item.label,
      dimension: item.dimension,
      kind: item.kind,
      points: pointsByIndex.get(index) ?? [],
    })),
    selectedSeries: series.map((item) => item.id),
    daysRequested: days,
    availableDays: numberValue(summary?.available_days),
    firstDate: summary?.first_date ?? null,
    lastDate: summary?.last_date ?? null,
    refreshedAt: summary?.refreshed_at ?? null,
    latestObservationAt: summary?.refreshed_at ?? null,
    partialDay: numberValue(summary?.partial_day) === 1,
    live: true,
    pollingSeconds: 60,
    historicalDaysFrozen: true,
    currentDayObservations: todayCount,
    previousDayObservations: previousCount,
    currentDayCoveragePct: previousCount > 0 ? Math.min(100, Math.round(todayCount / previousCount * 1000) / 10) : null,
    method: "clickhouse_trimmed_mean_dynamic_series",
    trimLowerPct: 5,
    trimUpperPct: 95,
    minimumPresencePct: 0,
    currency: "CLP",
    maxSeries: 8,
    cacheHit: false,
    dataSource: "clickhouse",
  };
}
