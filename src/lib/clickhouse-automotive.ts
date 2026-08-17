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
  list_price: Numeric;
  brand_bonus: Numeric;
  online_bonus: Numeric;
  dealer_bonus: Numeric;
  cash_price: Numeric;
  finance_bonus: Numeric;
  final_price: Numeric;
  observed_at: string | null;
};

type AutomotiveVariationHistoryRow = {
  id: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  current_price: Numeric;
  previous_price: Numeric;
  observed_at: string | null;
  previous_observed_at: string | null;
};

type ScopedAccess = EnterpriseAccessContext & { brands?: string[] };
type AutomotiveFilters = { brand?: string | null; model?: string | null; dealer?: string | null };
type Grade = "entry" | "mid" | "top";

type SourcePolicyRow = {
  brand: string;
  dealer: string;
  model?: string;
  version?: string;
  versions?: Numeric;
};

const AUTOMOTIVE_SOURCE_PRIORITY: Record<string, string[]> = {
  audi: ["Cartoni"],
  byd: ["Cartoni", "Salazar Israel"],
  changan: ["Dercocenter"],
  chery: ["Rosselot", "Salazar Israel"],
  citroen: ["Rosselot", "Pompeyo Carrasco"],
  cupra: ["Cartoni", "Salazar Israel"],
  dfsk: ["Salazar Israel", "Pompeyo Carrasco"],
  dongfeng: ["Rosselot", "Pompeyo Carrasco"],
  fiat: ["Rosselot"],
  foton: ["Rosselot"],
  geely: ["Cartoni", "Salazar Israel", "Pompeyo Carrasco"],
  gwm: ["Dercocenter"],
  hyundai: ["Bruno Fritsch", "Portillo"],
  jeep: ["Rosselot"],
  jetour: ["Rosselot", "Salazar Israel"],
  jmc: ["Cartoni", "Rosselot"],
  kgm: ["Cartoni", "Rosselot", "Salazar Israel"],
  kia: ["Berrios", "Pompeyo Carrasco"],
  landrover: ["Salazar Israel"],
  landking: ["Rosselot"],
  leapmotor: ["Rosselot", "Pompeyo Carrasco"],
  lexus: ["Bruno Fritsch", "Portillo"],
  mg: ["Cartoni", "Salazar Israel", "Pompeyo Carrasco"],
  mitsubishi: ["Rosselot", "Salazar Israel"],
  nissan: ["Bruno Fritsch", "Pompeyo Carrasco", "Portillo"],
  opel: ["Rosselot", "Portillo", "Pompeyo Carrasco"],
  peugeot: ["Rosselot", "Pompeyo Carrasco", "Portillo"],
  porsche: ["Salazar Israel"],
  ram: ["Rosselot", "Salazar Israel"],
  seat: ["Cartoni"],
  sinotruk: ["Indumotora"],
  skoda: ["Cartoni"],
  soueast: ["Rosselot"],
  subaru: ["Subaru Chile", "Salazar Israel", "Pompeyo Carrasco"],
  suzuki: ["Dercocenter"],
  toyota: ["Bruno Fritsch", "Cartoni", "Portillo"],
  volkswagen: ["Cartoni", "Salazar Israel"],
  volvo: ["Salazar Israel"],
};

function number(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: string | null | undefined, max = 180) {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizedKey(value: string | null | undefined) {
  return clean(value, 220)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "");
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

function automotiveModelExpression() {
  return `coalesce(nullIf(${metadataString("model")}, ''), nullIf(p.parent_external_id, ''), p.name)`;
}

function autoPredicates(access: ScopedAccess, params: ClickHouseParams) {
  const predicates = [
    "p.retailer_type = 'automotive'",
    "p.industry_slug = 'automotive'",
    `${metadataString("capture_status")} != 'invalid_identity'`,
  ];
  const allowedBrands = [...new Set((access.brands ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 100);
  if (allowedBrands.length) {
    const placeholders = allowedBrands.map((brand, index) => addString(params, `scope_brand_${index}`, brand));
    predicates.push(`p.brand IN (${placeholders.join(", ")})`);
  }
  return predicates;
}

function addBrandModelFilters(predicates: string[], params: ClickHouseParams, filters: AutomotiveFilters) {
  const brand = clean(filters.brand);
  const model = clean(filters.model, 220);
  if (brand) predicates.push(`p.brand = ${addString(params, "requested_brand", brand)}`);
  if (model) predicates.push(`${automotiveModelExpression()} = ${addString(params, "requested_model", model)}`);
}

function genericVersion(value: string | null | undefined) {
  const key = normalizedKey(value);
  return !key || key === "preciodesde" || key === "versionnoinformada" || key === "modelo";
}

function chooseDealer<T extends SourcePolicyRow>(brand: string, rows: T[]) {
  const available = [...new Set(rows.map((row) => row.dealer).filter(Boolean))];
  const preferred = AUTOMOTIVE_SOURCE_PRIORITY[normalizedKey(brand)] ?? [];
  for (const requested of preferred) {
    const match = available.find((dealer) => normalizedKey(dealer) === normalizedKey(requested));
    if (match) return match;
  }

  const scores = new Map<string, number>();
  for (const row of rows) {
    const volume = row.versions !== undefined ? Math.max(1, number(row.versions)) : 1;
    const versionBoost = row.version !== undefined && !genericVersion(row.version) ? volume * 10 : volume;
    scores.set(row.dealer, (scores.get(row.dealer) ?? 0) + versionBoost);
  }
  return [...available].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b, "es"))[0] ?? "";
}

function applySingleSourcePolicy<T extends SourcePolicyRow>(rows: T[]) {
  const byBrand = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizedKey(row.brand);
    if (!key) continue;
    const group = byBrand.get(key) ?? [];
    group.push(row);
    byBrand.set(key, group);
  }

  const selected: T[] = [];
  for (const brandRows of byBrand.values()) {
    const dealer = chooseDealer(brandRows[0]?.brand ?? "", brandRows);
    selected.push(...brandRows.filter((row) => row.dealer === dealer));
  }
  return selected;
}

function filterSelectedDealer<T extends SourcePolicyRow>(rows: T[], dealer: string | null | undefined) {
  const requested = clean(dealer);
  return requested ? rows.filter((row) => row.dealer === requested) : rows;
}

function latestDate(rows: Array<{ observed_at?: string | null }>) {
  const values = rows.map((row) => row.observed_at).filter((value): value is string => Boolean(value)).sort();
  return values.at(-1) ?? null;
}

function previousWeekWindowSql() {
  return {
    start: "subtractDays(toStartOfWeek(toTimeZone(now(), 'America/Santiago'), 1), 7)",
    end: "toStartOfWeek(toTimeZone(now(), 'America/Santiago'), 1)",
  };
}

export async function clickHouseAutomotiveOptions(accessInput: EnterpriseAccessContext) {
  const access = accessInput as ScopedAccess;
  const params: ClickHouseParams = {};
  const predicates = autoPredicates(access, params);
  const rawRows = await clickHouseQuery<AutomotiveOptionRow>(`
    SELECT
      ifNull(p.brand, '') AS brand,
      ${automotiveModelExpression()} AS model,
      p.supermarket AS dealer,
      uniqExact(p.id) AS versions
    FROM products AS p FINAL
    WHERE ${predicates.join("\n      AND ")}
      AND notEmpty(ifNull(p.brand, ''))
    GROUP BY brand, model, dealer
    ORDER BY brand ASC, model ASC, dealer ASC
    LIMIT 10000
  `, params, 7_000);

  const rows = applySingleSourcePolicy(rawRows);
  const brands = [...new Map(rows.filter((row) => row.brand).map((row) => [normalizedKey(row.brand), row.brand])).values()]
    .sort((a, b) => a.localeCompare(b, "es"));
  const models = [...new Set(rows.map((row) => `${row.brand}\u0000${row.model}`))]
    .map((value) => { const [brand, model] = value.split("\u0000"); return { brand, model }; })
    .filter((item) => item.brand && item.model)
    .sort((a, b) => a.brand.localeCompare(b.brand, "es") || a.model.localeCompare(b.model, "es"));
  const dealers = [...new Set(rows.map((row) => row.dealer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return { brands, models, dealers, singleSourcePerBrand: true as const };
}

export async function clickHouseAutomotiveCatalog(
  accessInput: EnterpriseAccessContext,
  filters: AutomotiveFilters,
) {
  const access = accessInput as ScopedAccess;
  const params: ClickHouseParams = {};
  const predicates = autoPredicates(access, params);
  addBrandModelFilters(predicates, params, filters);

  const rawRows = await clickHouseQuery<AutomotiveVehicleRow>(`
    SELECT
      toString(p.id) AS id,
      ifNull(p.brand, '') AS brand,
      ${automotiveModelExpression()} AS model,
      coalesce(nullIf(p.variant, ''), nullIf(${metadataString("version")}, ''), 'Versión no informada') AS version,
      p.supermarket AS dealer,
      if(${metadataNumber("list_price")} > 0, ${metadataNumber("list_price")}, toFloat64(ifNull(s.regular_price, 0))) AS list_price,
      ${metadataNumber("brand_bonus")} AS brand_bonus,
      ${metadataNumber("online_bonus")} AS online_bonus,
      ${metadataNumber("dealer_bonus")} AS dealer_bonus,
      if(${metadataNumber("cash_price")} > 0, ${metadataNumber("cash_price")}, toFloat64(ifNull(s.regular_price, 0))) AS cash_price,
      ${metadataNumber("finance_bonus")} AS finance_bonus,
      if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), ${metadataNumber("final_price")}) AS final_price,
      toString(s.observed_at) AS observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY final_price ASC, brand ASC, model ASC, version ASC, dealer ASC
    LIMIT 5000
  `, params, 9_000);

  const policyRows = applySingleSourcePolicy(rawRows);
  const rows = filterSelectedDealer(policyRows, filters.dealer);
  const brandKeys = new Set(rows.map((row) => normalizedKey(row.brand)).filter(Boolean));
  const modelKeys = new Set(rows.map((row) => `${normalizedKey(row.brand)}\u0000${normalizedKey(row.model)}`).filter(Boolean));
  const dealers = new Set(rows.map((row) => row.dealer).filter(Boolean));

  return {
    source: "clickhouse" as const,
    sourcePolicy: "single_source_per_brand" as const,
    summary: {
      brands: brandKeys.size,
      models: modelKeys.size,
      versions: new Set(rows.map((row) => row.id)).size,
      dealers: dealers.size,
      lastObservedAt: latestDate(rows),
    },
    vehicles: rows.map((row) => ({
      id: row.id,
      brand: row.brand,
      model: row.model,
      version: row.version,
      dealer: row.dealer,
      listPrice: number(row.list_price),
      brandBonus: number(row.brand_bonus),
      onlineBonus: number(row.online_bonus),
      dealerBonus: number(row.dealer_bonus),
      cashPrice: number(row.cash_price),
      financeBonus: number(row.finance_bonus),
      finalPrice: number(row.final_price),
      observedAt: row.observed_at,
    })),
  };
}

function gradeRows(rows: AutomotiveVariationHistoryRow[]) {
  const grouped = new Map<string, AutomotiveVariationHistoryRow[]>();
  for (const row of rows) {
    if (genericVersion(row.version) || number(row.current_price) <= 0) continue;
    const key = `${normalizedKey(row.brand)}\u0000${normalizedKey(row.model)}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const output: Array<AutomotiveVariationHistoryRow & { grade: Grade }> = [];
  for (const modelRows of grouped.values()) {
    const sorted = [...modelRows].sort((a, b) => number(a.current_price) - number(b.current_price) || a.version.localeCompare(b.version, "es"));
    if (!sorted.length) continue;
    output.push({ ...sorted[0], grade: "entry" });
    if (sorted.length >= 3) output.push({ ...sorted[Math.floor(sorted.length / 2)], grade: "mid" });
    if (sorted.length >= 2) output.push({ ...sorted.at(-1)!, grade: "top" });
  }
  return output;
}

function variationSummary(rows: ReturnType<typeof gradeRows>, grade: Grade) {
  const selected = rows.filter((row) => row.grade === grade);
  const comparable = selected.filter((row) => number(row.previous_price) > 0);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const currentAverage = average(selected.map((row) => number(row.current_price)));
  const comparableCurrentAverage = average(comparable.map((row) => number(row.current_price)));
  const previousAverage = average(comparable.map((row) => number(row.previous_price)));
  const absoluteChange = comparable.length ? comparableCurrentAverage - previousAverage : 0;
  const percentageChange = previousAverage > 0 ? (absoluteChange / previousAverage) * 100 : null;
  return {
    models: selected.length,
    comparableModels: comparable.length,
    currentAverage,
    previousAverage,
    absoluteChange,
    percentageChange,
  };
}

async function automotiveVariationHistoryFromObservations(access: ScopedAccess, filters: AutomotiveFilters) {
  const params: ClickHouseParams = {};
  const predicates = autoPredicates(access, params);
  addBrandModelFilters(predicates, params, filters);
  const week = previousWeekWindowSql();
  return await clickHouseQuery<AutomotiveVariationHistoryRow>(`
    SELECT
      toString(p.id) AS id,
      ifNull(p.brand, '') AS brand,
      ${automotiveModelExpression()} AS model,
      coalesce(nullIf(p.variant, ''), nullIf(${metadataString("version")}, ''), 'Versión no informada') AS version,
      p.supermarket AS dealer,
      if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), if(${metadataNumber("final_price")} > 0, ${metadataNumber("final_price")}, toFloat64(ifNull(s.regular_price, 0)))) AS current_price,
      argMaxIf(
        if(toFloat64(ifNull(o.offer_price, 0)) > 0, toFloat64(o.offer_price), toFloat64(ifNull(o.regular_price, 0))),
        o.observed_at,
        o.observed_at >= ${week.start} AND o.observed_at < ${week.end}
      ) AS previous_price,
      toString(s.observed_at) AS observed_at,
      toString(maxIf(o.observed_at, o.observed_at >= ${week.start} AND o.observed_at < ${week.end})) AS previous_observed_at
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    LEFT JOIN price_observations AS o FINAL
      ON o.product_id = p.id
      AND o.observed_at >= ${week.start}
      AND o.observed_at < ${week.end}
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.id, brand, model, version, dealer, current_price, s.observed_at
    ORDER BY brand ASC, model ASC, current_price ASC
    LIMIT 10000
  `, params, 12_000);
}

async function automotiveVariationHistoryFromDaily(access: ScopedAccess, filters: AutomotiveFilters) {
  const params: ClickHouseParams = {};
  const predicates = autoPredicates(access, params);
  addBrandModelFilters(predicates, params, filters);
  const week = previousWeekWindowSql();
  predicates.push("d.effective_price > 0");
  predicates.push(`d.price_date >= toDate(${week.start})`);
  return await clickHouseQuery<AutomotiveVariationHistoryRow>(`
    SELECT
      toString(p.id) AS id,
      ifNull(p.brand, '') AS brand,
      ${automotiveModelExpression()} AS model,
      coalesce(nullIf(p.variant, ''), nullIf(${metadataString("version")}, ''), 'Versión no informada') AS version,
      p.supermarket AS dealer,
      argMax(toFloat64(d.effective_price), d.observed_at) AS current_price,
      argMaxIf(
        toFloat64(d.effective_price),
        d.observed_at,
        d.price_date >= toDate(${week.start}) AND d.price_date < toDate(${week.end})
      ) AS previous_price,
      toString(max(d.observed_at)) AS observed_at,
      toString(maxIf(d.observed_at, d.price_date >= toDate(${week.start}) AND d.price_date < toDate(${week.end}))) AS previous_observed_at
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE ${predicates.join("\n      AND ")}
    GROUP BY p.id, brand, model, version, dealer
    ORDER BY brand ASC, model ASC, current_price ASC
    LIMIT 10000
  `, params, 12_000);
}

export async function clickHouseAutomotiveVariations(
  accessInput: EnterpriseAccessContext,
  filters: AutomotiveFilters,
) {
  const access = accessInput as ScopedAccess;
  let rawRows: AutomotiveVariationHistoryRow[];
  try {
    rawRows = await automotiveVariationHistoryFromObservations(access, filters);
  } catch {
    rawRows = await automotiveVariationHistoryFromDaily(access, filters);
  }

  const policyRows = applySingleSourcePolicy(rawRows);
  const selectedRows = filterSelectedDealer(policyRows, filters.dealer);
  const graded = gradeRows(selectedRows);
  const rows = graded.map((row) => {
    const currentPrice = number(row.current_price);
    const previousPrice = number(row.previous_price);
    const absoluteChange = previousPrice > 0 ? currentPrice - previousPrice : null;
    const percentageChange = previousPrice > 0 ? ((currentPrice - previousPrice) / previousPrice) * 100 : null;
    return {
      id: row.id,
      brand: row.brand,
      model: row.model,
      version: row.version,
      dealer: row.dealer,
      grade: row.grade,
      currentPrice,
      previousPrice,
      absoluteChange,
      percentageChange,
      observedAt: row.observed_at,
      previousObservedAt: row.previous_observed_at,
    };
  });

  return {
    source: "clickhouse" as const,
    sourcePolicy: "single_source_per_brand" as const,
    comparison: "previous_week" as const,
    gradeMethod: "price_rank_per_model" as const,
    summaries: {
      entry: variationSummary(graded, "entry"),
      mid: variationSummary(graded, "mid"),
      top: variationSummary(graded, "top"),
    },
    rows,
  };
}
