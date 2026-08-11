import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export type ContextualTrendPayload = {
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
  autoSelected: boolean;
  mode: string;
  scopeLabel: string;
  dataSource?: "clickhouse" | "supabase";
};

type TrendFilters = {
  days: number;
  retailerType: string | null;
  supermarket: string | null;
  category: string | null;
  brand: string | null;
  stock: "all" | "in" | "out";
};

type SeriesDefinition = {
  id: string;
  label: string;
  kind: "group" | "smart" | "brand";
  filterColumn: "retailer_type" | "smart_category" | "brand";
  filterValue: string;
};

type RankedValueRow = { value: string; products: number | string };
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
  partial_day: number | string;
};

const SMART_CATEGORY = "coalesce(nullIf(trimBoth(p.smart_category), ''), nullIf(trimBoth(d.category), ''))";
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

function buildSource(access: EnterpriseAccessContext, filters: TrendFilters, params: ClickHouseParams) {
  params.days_back = { type: "UInt16", value: Math.max(0, filters.days - 1) };
  const predicates = [
    `d.price_date >= subtractDays(${TODAY_SANTIAGO}, {days_back:UInt16})`,
    "d.effective_price > 0",
  ];

  addStringList(predicates, params, "d.supermarket", access.retailers, "scope_retailer");
  addStringList(predicates, params, "d.brand", access.brands, "scope_brand");
  addStringList(predicates, params, SMART_CATEGORY, access.categories, "scope_category");

  if (access.industryConfigured && access.industrySlug) {
    predicates.push(`p.industry_slug = ${addString(params, "scope_industry", access.industrySlug)}`);
  }
  if (filters.retailerType) {
    predicates.push(`p.retailer_type = ${addString(params, "filter_retailer_type", filters.retailerType)}`);
  }
  if (filters.supermarket) {
    predicates.push(`d.supermarket = ${addString(params, "filter_supermarket", filters.supermarket)}`);
  }
  if (filters.category) {
    predicates.push(`${SMART_CATEGORY} = ${addString(params, "filter_category", filters.category)}`);
  }
  if (filters.brand) {
    predicates.push(`d.brand = ${addString(params, "filter_brand", filters.brand)}`);
  }
  if (filters.stock === "in") predicates.push("ls.in_stock = true");
  if (filters.stock === "out") predicates.push("ls.in_stock = false");

  return `
    SELECT
      d.product_id,
      d.price_date,
      d.observed_at,
      d.supermarket,
      d.brand,
      ${SMART_CATEGORY} AS smart_category,
      p.retailer_type,
      toFloat64(d.effective_price) AS effective_price
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    LEFT JOIN product_latest_price_state AS ls FINAL ON ls.product_id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
  `;
}

function modeFor(filters: TrendFilters) {
  if (filters.brand) return "brand";
  if (filters.category) return "brand_top";
  if (filters.supermarket || filters.retailerType) return "category_top";
  return "retailer_type";
}

function scopeLabel(mode: string, filters: TrendFilters) {
  if (mode === "brand") return `${filters.brand} · evolución de precio promedio`;
  if (mode === "brand_top") return `Top 3 marcas · ${filters.category}`;
  if (mode === "category_top" && filters.supermarket) return `Top 3 categorías · ${filters.supermarket}`;
  if (mode === "category_top") {
    const label = filters.retailerType === "pharmacy"
      ? "Farmacias"
      : filters.retailerType === "supermarket"
        ? "Supermercados"
        : "Multitiendas";
    return `Top 3 categorías · ${label}`;
  }
  return "Supermercados vs Farmacias · índice base 100";
}

async function rankedSeries(
  access: EnterpriseAccessContext,
  filters: TrendFilters,
  field: "brand" | "smart_category",
) {
  const params: ClickHouseParams = {};
  const source = buildSource(access, filters, params);
  const rows = await clickHouseQuery<RankedValueRow>(`
    WITH source AS (${source})
    SELECT
      ${field} AS value,
      uniqExact(product_id) AS products
    FROM source
    WHERE notEmpty(ifNull(${field}, ''))
    GROUP BY value
    ORDER BY products DESC, value ASC
    LIMIT 3
  `, params);
  return rows.map((row) => row.value).filter(Boolean);
}

async function seriesDefinitions(
  access: EnterpriseAccessContext,
  filters: TrendFilters,
  mode: string,
): Promise<SeriesDefinition[]> {
  if (mode === "brand") {
    return [{
      id: `brand:${filters.brand}`,
      label: filters.brand ?? "Marca",
      kind: "brand",
      filterColumn: "brand",
      filterValue: filters.brand ?? "",
    }];
  }

  if (mode === "brand_top") {
    const values = await rankedSeries(access, filters, "brand");
    return values.map((value) => ({
      id: `brand:${value}`,
      label: value,
      kind: "brand" as const,
      filterColumn: "brand" as const,
      filterValue: value,
    }));
  }

  if (mode === "category_top") {
    const values = await rankedSeries(access, filters, "smart_category");
    return values.map((value) => ({
      id: `smart:${value}`,
      label: value,
      kind: "smart" as const,
      filterColumn: "smart_category" as const,
      filterValue: value,
    }));
  }

  return [
    {
      id: "scope:supermarkets",
      label: "Supermercados",
      kind: "group",
      filterColumn: "retailer_type",
      filterValue: "supermarket",
    },
    {
      id: "scope:pharmacies",
      label: "Farmacias",
      kind: "group",
      filterColumn: "retailer_type",
      filterValue: "pharmacy",
    },
  ];
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

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function contextualPricingTrendFromClickHouse(
  access: EnterpriseAccessContext,
  filters: TrendFilters,
): Promise<ContextualTrendPayload> {
  const mode = modeFor(filters);
  const definitions = await seriesDefinitions(access, filters, mode);

  if (!definitions.length) {
    return {
      series: [],
      selectedSeries: [],
      daysRequested: filters.days,
      availableDays: 0,
      firstDate: null,
      lastDate: null,
      refreshedAt: null,
      latestObservationAt: null,
      partialDay: false,
      live: true,
      pollingSeconds: 60,
      historicalDaysFrozen: true,
      currentDayObservations: 0,
      previousDayObservations: 0,
      currentDayCoveragePct: null,
      method: "clickhouse_trimmed_mean_contextual_auto_series",
      trimLowerPct: 5,
      trimUpperPct: 95,
      minimumPresencePct: 0,
      currency: "CLP",
      maxSeries: 3,
      autoSelected: true,
      mode,
      scopeLabel: scopeLabel(mode, filters),
      dataSource: "clickhouse",
    };
  }

  const params: ClickHouseParams = {};
  const source = buildSource(access, filters, params);
  const matched = matchedSql(source, definitions, params);

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
      if(count() = 0, 0, max(price_date) = ${TODAY_SANTIAGO}) AS partial_day
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
    series: definitions.map((item, index) => ({
      id: item.id,
      label: item.label,
      dimension: item.kind === "brand" ? "brand" : "category",
      kind: item.kind,
      points: pointsByIndex.get(index) ?? [],
    })),
    selectedSeries: definitions.map((item) => item.id),
    daysRequested: filters.days,
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
    method: "clickhouse_trimmed_mean_contextual_auto_series",
    trimLowerPct: 5,
    trimUpperPct: 95,
    minimumPresencePct: 0,
    currency: "CLP",
    maxSeries: 3,
    autoSelected: true,
    mode,
    scopeLabel: scopeLabel(mode, filters),
    dataSource: "clickhouse",
  };
}
