import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";
import { clickHouseAutomotiveCatalog } from "@/lib/clickhouse-automotive";

type Numeric = string | number;
export type AutomotiveBrandComparison = "previous_week" | "previous_month";

type HistoricalPriceRow = {
  id: string;
  previous_price: Numeric;
  previous_observed_at: string | null;
};

type CatalogVehicle = Awaited<ReturnType<typeof clickHouseAutomotiveCatalog>>["vehicles"][number];

type BrandComparableVehicle = {
  id: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  currentPrice: number;
  previousPrice: number;
  observedAt: string | null;
  previousObservedAt: string | null;
};

type BrandMovement = {
  brand: string;
  dealer: string;
  currentAverage: number;
  previousAverage: number;
  absoluteChange: number;
  percentageChange: number | null;
  versions: number;
  comparableVersions: number;
  increasedVersions: number;
  decreasedVersions: number;
  unchangedVersions: number;
  observedAt: string | null;
  previousObservedAt: string | null;
};

type AutomotiveFilters = { brand?: string | null; model?: string | null; dealer?: string | null };

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

function genericVersion(value: string | null | undefined) {
  const key = normalizedKey(value);
  return !key || key === "preciodesde" || key === "versionnoinformada" || key === "modelo";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function latest(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

// Comparisons use the complete prior calendar period in Chile, not a fixed rolling-day offset.
function comparisonWindow(comparison: AutomotiveBrandComparison) {
  if (comparison === "previous_month") {
    return {
      startSql: "subtractMonths(toStartOfMonth(toTimeZone(now(), 'America/Santiago')), 1)",
      endSql: "toStartOfMonth(toTimeZone(now(), 'America/Santiago'))",
      label: "mes pasado" as const,
    };
  }

  return {
    startSql: "subtractDays(toStartOfWeek(toTimeZone(now(), 'America/Santiago'), 1), 7)",
    endSql: "toStartOfWeek(toTimeZone(now(), 'America/Santiago'), 1)",
    label: "semana pasada" as const,
  };
}

function dedupeCurrentVersions(vehicles: CatalogVehicle[]) {
  const selected = new Map<string, CatalogVehicle>();
  for (const vehicle of vehicles) {
    if (genericVersion(vehicle.version) || number(vehicle.finalPrice) <= 0) continue;
    const key = [vehicle.brand, vehicle.model, vehicle.version, vehicle.dealer].map(normalizedKey).join("\u0000");
    const existing = selected.get(key);
    if (!existing || String(vehicle.observedAt ?? "") > String(existing.observedAt ?? "")) selected.set(key, vehicle);
  }
  return [...selected.values()];
}

async function historicalPrices(vehicles: CatalogVehicle[], comparison: AutomotiveBrandComparison) {
  if (!vehicles.length) return [] as HistoricalPriceRow[];
  const pairs = [...new Map(vehicles.map((vehicle) => [
    `${normalizedKey(vehicle.brand)}\u0000${normalizedKey(vehicle.dealer)}`,
    { brand: vehicle.brand, dealer: vehicle.dealer },
  ])).values()];

  const params: ClickHouseParams = {};
  const pairClauses = pairs.map((pair, index) => {
    params[`brand_${index}`] = { type: "String", value: pair.brand };
    params[`dealer_${index}`] = { type: "String", value: pair.dealer };
    return `(p.brand = {brand_${index}:String} AND p.supermarket = {dealer_${index}:String})`;
  });
  const window = comparisonWindow(comparison);

  return await clickHouseQuery<HistoricalPriceRow>(`
    SELECT
      toString(p.id) AS id,
      argMaxIf(
        if(toFloat64(ifNull(o.offer_price, 0)) > 0, toFloat64(o.offer_price), toFloat64(ifNull(o.regular_price, 0))),
        o.observed_at,
        o.observed_at >= ${window.startSql}
          AND o.observed_at < ${window.endSql}
      ) AS previous_price,
      toString(maxIf(
        o.observed_at,
        o.observed_at >= ${window.startSql}
          AND o.observed_at < ${window.endSql}
      )) AS previous_observed_at
    FROM products AS p FINAL
    LEFT JOIN price_observations AS o FINAL
      ON o.product_id = p.id
      AND o.observed_at >= ${window.startSql}
      AND o.observed_at < ${window.endSql}
    WHERE p.retailer_type = 'automotive'
      AND p.industry_slug = 'automotive'
      AND JSONExtractString(toString(p.source_metadata), 'capture_status') != 'invalid_identity'
      AND (${pairClauses.join(" OR ")})
    GROUP BY p.id
    LIMIT 15000
  `, params, 14_000);
}

function summarizeBrand(brandVehicles: BrandComparableVehicle[]): BrandMovement {
  const comparable = brandVehicles.filter((vehicle) => vehicle.previousPrice > 0);
  const currentAverage = comparable.length
    ? average(comparable.map((vehicle) => vehicle.currentPrice))
    : average(brandVehicles.map((vehicle) => vehicle.currentPrice));
  const previousAverage = average(comparable.map((vehicle) => vehicle.previousPrice));
  const absoluteChange = comparable.length ? currentAverage - previousAverage : 0;
  const percentageChange = previousAverage > 0 ? (absoluteChange / previousAverage) * 100 : null;
  const epsilon = 1;

  return {
    brand: brandVehicles[0]?.brand ?? "",
    dealer: brandVehicles[0]?.dealer ?? "",
    currentAverage,
    previousAverage,
    absoluteChange,
    percentageChange,
    versions: brandVehicles.length,
    comparableVersions: comparable.length,
    increasedVersions: comparable.filter((vehicle) => vehicle.currentPrice - vehicle.previousPrice > epsilon).length,
    decreasedVersions: comparable.filter((vehicle) => vehicle.currentPrice - vehicle.previousPrice < -epsilon).length,
    unchangedVersions: comparable.filter((vehicle) => Math.abs(vehicle.currentPrice - vehicle.previousPrice) <= epsilon).length,
    observedAt: latest(brandVehicles.map((vehicle) => vehicle.observedAt)),
    previousObservedAt: latest(comparable.map((vehicle) => vehicle.previousObservedAt)),
  };
}

export async function clickHouseAutomotiveBrandVariations(
  access: EnterpriseAccessContext,
  filters: AutomotiveFilters,
  comparison: AutomotiveBrandComparison,
) {
  const catalog = await clickHouseAutomotiveCatalog(access, filters);
  const currentVehicles = dedupeCurrentVersions(catalog.vehicles);
  const history = await historicalPrices(currentVehicles, comparison);
  const historicalById = new Map(history.map((row) => [row.id, row]));

  const enriched: BrandComparableVehicle[] = currentVehicles.map((vehicle) => {
    const previous = historicalById.get(vehicle.id);
    return {
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      version: vehicle.version,
      dealer: vehicle.dealer,
      currentPrice: number(vehicle.finalPrice),
      previousPrice: number(previous?.previous_price),
      observedAt: vehicle.observedAt,
      previousObservedAt: previous?.previous_observed_at ?? null,
    };
  });

  const byBrand = new Map<string, BrandComparableVehicle[]>();
  for (const vehicle of enriched) {
    const key = normalizedKey(vehicle.brand);
    const group = byBrand.get(key) ?? [];
    group.push(vehicle);
    byBrand.set(key, group);
  }

  const rows = [...byBrand.values()]
    .map(summarizeBrand)
    .filter((row) => row.brand)
    .sort((a, b) => {
      if (a.percentageChange === null && b.percentageChange !== null) return 1;
      if (a.percentageChange !== null && b.percentageChange === null) return -1;
      return (a.percentageChange ?? 0) - (b.percentageChange ?? 0) || a.brand.localeCompare(b.brand, "es");
    });

  const comparableBrands = rows.filter((row) => row.percentageChange !== null);
  const brandsUp = comparableBrands.filter((row) => (row.percentageChange ?? 0) > 0.005);
  const brandsDown = comparableBrands.filter((row) => (row.percentageChange ?? 0) < -0.005);
  const brandsStable = comparableBrands.length - brandsUp.length - brandsDown.length;
  const highestIncrease = [...brandsUp].sort((a, b) => (b.percentageChange ?? 0) - (a.percentageChange ?? 0))[0] ?? null;
  const biggestDecrease = [...brandsDown].sort((a, b) => (a.percentageChange ?? 0) - (b.percentageChange ?? 0))[0] ?? null;

  return {
    source: "clickhouse" as const,
    sourcePolicy: "single_source_per_brand" as const,
    comparison,
    comparisonLabel: comparisonWindow(comparison).label,
    methodology: "same_version_same_source" as const,
    summary: {
      brands: rows.length,
      comparableBrands: comparableBrands.length,
      brandsUp: brandsUp.length,
      brandsDown: brandsDown.length,
      brandsStable,
      marketPercentageChange: comparableBrands.length ? average(comparableBrands.map((row) => row.percentageChange ?? 0)) : null,
      marketAbsoluteChange: comparableBrands.length ? average(comparableBrands.map((row) => row.absoluteChange)) : 0,
      highestIncrease: highestIncrease ? { brand: highestIncrease.brand, percentageChange: highestIncrease.percentageChange } : null,
      biggestDecrease: biggestDecrease ? { brand: biggestDecrease.brand, percentageChange: biggestDecrease.percentageChange } : null,
    },
    rows,
  };
}
