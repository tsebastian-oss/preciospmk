import { NextRequest } from "next/server";
import {
  enterpriseReadRpc,
  type EnterpriseAccessContext,
} from "@/lib/enterprise-auth";

type Numeric = string | number;
type AutomotiveFilters = { brand?: string | null; model?: string | null; dealer?: string | null };
type Grade = "entry" | "mid" | "top";
export type AutomotiveBrandComparison = "previous_week" | "previous_month";

type OptionRow = {
  brand: string;
  model: string;
  dealer: string;
  versions: Numeric;
};

type DataRow = {
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
  current_price: Numeric;
  observed_at: string | null;
  previous_price: Numeric;
  previous_observed_at: string | null;
};

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

function latest(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function optionRows(request: NextRequest, access: EnterpriseAccessContext) {
  return enterpriseReadRpc<{ rows: OptionRow[] }>(
    request,
    "automotive_options_rows",
    { p_organization_id: access.organizationId },
    { attempts: 2, timeoutMs: 15_000 },
  );
}

async function dataRows(
  request: NextRequest,
  access: EnterpriseAccessContext,
  filters: AutomotiveFilters,
  window: "none" | AutomotiveBrandComparison,
) {
  return enterpriseReadRpc<{ rows: DataRow[] }>(
    request,
    "automotive_data_rows",
    {
      p_organization_id: access.organizationId,
      p_brand: clean(filters.brand) || null,
      p_model: clean(filters.model, 220) || null,
      p_window: window,
    },
    { attempts: 2, timeoutMs: 20_000 },
  );
}

export async function supabaseAutomotiveOptions(request: NextRequest, access: EnterpriseAccessContext) {
  const result = await optionRows(request, access);
  if (result.response) return { response: result.response };
  const rows = applySingleSourcePolicy(result.data?.rows ?? []);
  const brands = [...new Map(rows.filter((row) => row.brand).map((row) => [normalizedKey(row.brand), row.brand])).values()]
    .sort((a, b) => a.localeCompare(b, "es"));
  const models = [...new Set(rows.map((row) => `${row.brand}\u0000${row.model}`))]
    .map((value) => {
      const [brand, model] = value.split("\u0000");
      return { brand, model };
    })
    .filter((item) => item.brand && item.model)
    .sort((a, b) => a.brand.localeCompare(b.brand, "es") || a.model.localeCompare(b.model, "es"));
  const dealers = [...new Set(rows.map((row) => row.dealer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return { data: { source: "supabase" as const, brands, models, dealers, singleSourcePerBrand: true as const } };
}

export async function supabaseAutomotiveCatalog(
  request: NextRequest,
  access: EnterpriseAccessContext,
  filters: AutomotiveFilters,
) {
  const result = await dataRows(request, access, filters, "none");
  if (result.response) return { response: result.response };
  const policyRows = applySingleSourcePolicy(result.data?.rows ?? []);
  const rows = filterSelectedDealer(policyRows, filters.dealer);
  return {
    data: {
      source: "supabase" as const,
      sourcePolicy: "single_source_per_brand" as const,
      summary: {
        brands: new Set(rows.map((row) => normalizedKey(row.brand)).filter(Boolean)).size,
        models: new Set(rows.map((row) => `${normalizedKey(row.brand)}\u0000${normalizedKey(row.model)}`)).size,
        versions: new Set(rows.map((row) => row.id)).size,
        dealers: new Set(rows.map((row) => row.dealer).filter(Boolean)).size,
        lastObservedAt: latest(rows.map((row) => row.observed_at)),
      },
      vehicles: rows
        .map((row) => ({
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
          finalPrice: number(row.current_price),
          observedAt: row.observed_at,
        }))
        .sort((a, b) => a.finalPrice - b.finalPrice || a.brand.localeCompare(b.brand, "es") || a.model.localeCompare(b.model, "es")),
    },
  };
}

function gradeRows(rows: DataRow[]) {
  const grouped = new Map<string, DataRow[]>();
  for (const row of rows) {
    if (genericVersion(row.version) || number(row.current_price) <= 0) continue;
    const key = `${normalizedKey(row.brand)}\u0000${normalizedKey(row.model)}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const output: Array<DataRow & { grade: Grade }> = [];
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
  const currentAverage = average(selected.map((row) => number(row.current_price)));
  const comparableCurrentAverage = average(comparable.map((row) => number(row.current_price)));
  const previousAverage = average(comparable.map((row) => number(row.previous_price)));
  const absoluteChange = comparable.length ? comparableCurrentAverage - previousAverage : 0;
  return {
    models: selected.length,
    comparableModels: comparable.length,
    currentAverage,
    previousAverage,
    absoluteChange,
    percentageChange: previousAverage > 0 ? (absoluteChange / previousAverage) * 100 : null,
  };
}

export async function supabaseAutomotiveVariations(
  request: NextRequest,
  access: EnterpriseAccessContext,
  filters: AutomotiveFilters,
) {
  const result = await dataRows(request, access, filters, "previous_week");
  if (result.response) return { response: result.response };
  const selected = filterSelectedDealer(applySingleSourcePolicy(result.data?.rows ?? []), filters.dealer);
  const graded = gradeRows(selected);
  const rows = graded.map((row) => {
    const currentPrice = number(row.current_price);
    const previousPrice = number(row.previous_price);
    return {
      id: row.id,
      brand: row.brand,
      model: row.model,
      version: row.version,
      dealer: row.dealer,
      grade: row.grade,
      currentPrice,
      previousPrice,
      absoluteChange: previousPrice > 0 ? currentPrice - previousPrice : null,
      percentageChange: previousPrice > 0 ? ((currentPrice - previousPrice) / previousPrice) * 100 : null,
      observedAt: row.observed_at,
      previousObservedAt: row.previous_observed_at,
    };
  });
  return {
    data: {
      source: "supabase" as const,
      sourcePolicy: "single_source_per_brand" as const,
      comparison: "previous_week" as const,
      gradeMethod: "price_rank_per_model" as const,
      summaries: {
        entry: variationSummary(graded, "entry"),
        mid: variationSummary(graded, "mid"),
        top: variationSummary(graded, "top"),
      },
      rows,
    },
  };
}

export async function supabaseAutomotiveBrandVariations(
  request: NextRequest,
  access: EnterpriseAccessContext,
  filters: AutomotiveFilters,
  comparison: AutomotiveBrandComparison,
) {
  const result = await dataRows(request, access, filters, comparison);
  if (result.response) return { response: result.response };
  const selected = filterSelectedDealer(applySingleSourcePolicy(result.data?.rows ?? []), filters.dealer)
    .filter((row) => !genericVersion(row.version) && number(row.current_price) > 0);

  const byBrand = new Map<string, DataRow[]>();
  for (const row of selected) {
    const key = normalizedKey(row.brand);
    const group = byBrand.get(key) ?? [];
    group.push(row);
    byBrand.set(key, group);
  }

  const rows = [...byBrand.values()].map((brandRows) => {
    const comparable = brandRows.filter((row) => number(row.previous_price) > 0);
    const currentAverage = comparable.length
      ? average(comparable.map((row) => number(row.current_price)))
      : average(brandRows.map((row) => number(row.current_price)));
    const previousAverage = average(comparable.map((row) => number(row.previous_price)));
    const absoluteChange = comparable.length ? currentAverage - previousAverage : 0;
    const epsilon = 1;
    return {
      brand: brandRows[0]?.brand ?? "",
      dealer: brandRows[0]?.dealer ?? "",
      currentAverage,
      previousAverage,
      absoluteChange,
      percentageChange: previousAverage > 0 ? (absoluteChange / previousAverage) * 100 : null,
      versions: brandRows.length,
      comparableVersions: comparable.length,
      increasedVersions: comparable.filter((row) => number(row.current_price) - number(row.previous_price) > epsilon).length,
      decreasedVersions: comparable.filter((row) => number(row.current_price) - number(row.previous_price) < -epsilon).length,
      unchangedVersions: comparable.filter((row) => Math.abs(number(row.current_price) - number(row.previous_price)) <= epsilon).length,
      observedAt: latest(brandRows.map((row) => row.observed_at)),
      previousObservedAt: latest(comparable.map((row) => row.previous_observed_at)),
    };
  }).filter((row) => row.brand).sort((a, b) => {
    if (a.percentageChange === null && b.percentageChange !== null) return 1;
    if (a.percentageChange !== null && b.percentageChange === null) return -1;
    return (a.percentageChange ?? 0) - (b.percentageChange ?? 0) || a.brand.localeCompare(b.brand, "es");
  });

  const comparableBrands = rows.filter((row) => row.percentageChange !== null);
  const brandsUp = comparableBrands.filter((row) => (row.percentageChange ?? 0) > 0.005);
  const brandsDown = comparableBrands.filter((row) => (row.percentageChange ?? 0) < -0.005);
  const highestIncrease = [...brandsUp].sort((a, b) => (b.percentageChange ?? 0) - (a.percentageChange ?? 0))[0] ?? null;
  const biggestDecrease = [...brandsDown].sort((a, b) => (a.percentageChange ?? 0) - (b.percentageChange ?? 0))[0] ?? null;

  return {
    data: {
      source: "supabase" as const,
      sourcePolicy: "single_source_per_brand" as const,
      comparison,
      comparisonLabel: comparison === "previous_month" ? "mes pasado" as const : "semana pasada" as const,
      methodology: "same_version_same_source" as const,
      summary: {
        brands: rows.length,
        comparableBrands: comparableBrands.length,
        brandsUp: brandsUp.length,
        brandsDown: brandsDown.length,
        brandsStable: comparableBrands.length - brandsUp.length - brandsDown.length,
        marketPercentageChange: comparableBrands.length ? average(comparableBrands.map((row) => row.percentageChange ?? 0)) : null,
        marketAbsoluteChange: comparableBrands.length ? average(comparableBrands.map((row) => row.absoluteChange)) : 0,
        highestIncrease: highestIncrease ? { brand: highestIncrease.brand, percentageChange: highestIncrease.percentageChange } : null,
        biggestDecrease: biggestDecrease ? { brand: biggestDecrease.brand, percentageChange: biggestDecrease.percentageChange } : null,
      },
      rows,
    },
  };
}
