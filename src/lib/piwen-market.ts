export type Numeric = number | string | null;

export type PiwenSnapshotListing = {
  id?: string;
  retailer?: string;
  brand?: string;
  name?: string;
  family?: string;
  grams?: Numeric;
  format?: string;
  currentPrice?: Numeric;
  regularPrice?: Numeric;
  pricePerKg?: Numeric;
  promotionPct?: Numeric;
  inStock?: boolean | null;
  observedAt?: string | null;
  url?: string;
};

export type PiwenMarketSnapshot = {
  status?: string;
  source?: string;
  observedAt?: string | null;
  products?: number;
  brands?: number;
  retailers?: number;
  listings?: PiwenSnapshotListing[];
};

export type PiwenOfficialSnapshot = {
  status?: string;
  source?: string;
  domain?: string;
  lastCrawledAt?: string | null;
  observedAt?: string | null;
  products?: number;
  pricedProducts?: number;
  inStockProducts?: number;
  listings?: PiwenSnapshotListing[];
};

export type PiwenMarketListing = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  family: string;
  grams: number | null;
  format: string;
  currentPrice: number;
  regularPrice: number | null;
  pricePerKg: number | null;
  promotionPct: number | null;
  inStock: boolean;
  observedAt: string | null;
  url: string;
};

export type PiwenSummaryRow = {
  key: string;
  skuCount: number;
  brands: number;
  retailers: number;
  families: number;
  averagePricePerKg: number | null;
  medianPricePerKg: number | null;
  minPricePerKg: number | null;
  maxPricePerKg: number | null;
  promoPct: number;
};

const SUBJECT_FAMILY_ORDER = ["Almendras", "Castañas de cajú", "Pistachos", "Mixes"] as const;

function numeric(value: Numeric | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: Numeric | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanBrand(value: string | null | undefined) {
  const brand = (value ?? "").replace(/\s+/g, " ").trim();
  return brand || "Sin marca";
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

function familyFor(name: string) {
  const n = normalized(name);
  if (/castan(?:a|as).*caju|caju|cashew/.test(n)) return "Castañas de cajú";
  if (/pistach/.test(n)) return "Pistachos";
  if (/almendr/.test(n)) return "Almendras";
  if (/avellan/.test(n)) return "Avellanas";
  if (/nuez|nueces/.test(n)) return "Nueces";
  if (/mani/.test(n)) return "Maní";
  if (/mix|frutos secos|trail mix/.test(n)) return "Mixes";
  if (/semilla|pepita/.test(n)) return "Semillas";
  if (/pasa|cranber|arandano|ciruela|damasco|fruta deshidrat/.test(n)) return "Fruta deshidratada";
  return null;
}

function isDirectComparable(name: string, family: string) {
  const n = normalized(name);
  if (/(mantequilla|pasta|crema|leche|bebida|yogur|helado|chocolate|galleta|barrita|barra |pan |muffin|donut|tarta|torta|cereal|granola|proteina|shampoo|acondicionador|mascarilla|aceite de)/.test(n)) return false;
  if (family === "Mixes" && /(cajun|cajuna)/.test(n) && !/frutos secos/.test(n)) return false;
  return true;
}

function gramsFor(name: string) {
  const n = normalized(name).replace(/,/g, ".");
  const kg = n.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg) {
    const value = Number(kg[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : null;
  }
  const g = n.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gramos)\b/);
  if (g) {
    const value = Number(g[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  return null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function rounded(value: number | null, digits = 0) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize<T extends { brand: string; retailer: string; family: string; pricePerKg: number | null; promotionPct: number | null }>(
  rows: T[],
  keyFn: (row: T) => string,
) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()].map(([key, items]) => {
    const unitPrices = items.map(item => item.pricePerKg).filter((value): value is number => value != null && Number.isFinite(value));
    const promoted = items.filter(item => (item.promotionPct ?? 0) > 0).length;
    return {
      key,
      skuCount: items.length,
      brands: new Set(items.map(item => item.brand)).size,
      retailers: new Set(items.map(item => item.retailer)).size,
      families: new Set(items.map(item => item.family)).size,
      averagePricePerKg: rounded(unitPrices.length ? unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length : null),
      medianPricePerKg: rounded(median(unitPrices)),
      minPricePerKg: rounded(unitPrices.length ? Math.min(...unitPrices) : null),
      maxPricePerKg: rounded(unitPrices.length ? Math.max(...unitPrices) : null),
      promoPct: rounded(items.length ? promoted / items.length * 100 : 0, 1) ?? 0,
    } satisfies PiwenSummaryRow;
  });
}

function percentileIndex(subject: number | null, market: number | null) {
  if (!subject || !market) return null;
  return rounded(subject / market * 100, 1);
}

function normalizeListing(row: PiwenSnapshotListing, defaults?: { retailer?: string; brand?: string }) {
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const family = String(row.family ?? "").trim() || familyFor(name);
  if (!family || !isDirectComparable(name, family)) return null;
  const grams = nullableNumeric(row.grams) ?? gramsFor(name);
  const currentPrice = numeric(row.currentPrice);
  if (currentPrice <= 0) return null;
  const regularPrice = nullableNumeric(row.regularPrice);
  const pricePerKg = nullableNumeric(row.pricePerKg) ?? (grams ? rounded(currentPrice * 1000 / grams) : null);
  const promotionPct = nullableNumeric(row.promotionPct)
    ?? (regularPrice && regularPrice > currentPrice ? rounded((regularPrice - currentPrice) / regularPrice * 100, 1) : null);

  return {
    id: String(row.id ?? `${defaults?.retailer ?? "source"}:${name}`),
    retailer: String(row.retailer ?? defaults?.retailer ?? "Sin retailer"),
    brand: cleanBrand(row.brand ?? defaults?.brand),
    name,
    family,
    grams,
    format: String(row.format ?? (grams ? (grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000} kg` : `${grams} g`) : "Sin formato")),
    currentPrice,
    regularPrice,
    pricePerKg,
    promotionPct,
    inStock: row.inStock !== false,
    observedAt: row.observedAt ?? null,
    url: String(row.url ?? ""),
  } satisfies PiwenMarketListing;
}

function subjectFromOfficial(snapshot: PiwenOfficialSnapshot | null | undefined) {
  const candidates = (snapshot?.listings ?? [])
    .map(row => normalizeListing(row, { retailer: "Piwén.cl", brand: "Piwén" }))
    .filter((row): row is PiwenMarketListing => Boolean(row))
    .filter(row => row.grams != null && row.grams >= 20 && row.grams <= 5000);

  const subject: PiwenMarketListing[] = [];
  for (const family of SUBJECT_FAMILY_ORDER) {
    const items = candidates
      .filter(row => row.family === family)
      .sort((a, b) =>
        Number(b.inStock) - Number(a.inStock)
        || (b.grams ?? 0) - (a.grams ?? 0)
        || (b.observedAt ?? "").localeCompare(a.observedAt ?? "")
      );
    if (items[0]) subject.push(items[0]);
  }
  return subject;
}

export function piwenMarketFallback(officialSnapshot?: PiwenOfficialSnapshot | null) {
  return piwenMarketIntelligence(null, officialSnapshot ?? null);
}

export function piwenMarketIntelligence(
  marketSnapshot?: PiwenMarketSnapshot | null,
  officialSnapshot?: PiwenOfficialSnapshot | null,
) {
  const market = (marketSnapshot?.listings ?? [])
    .map(row => normalizeListing(row))
    .filter((row): row is PiwenMarketListing => Boolean(row))
    .filter(row => row.grams != null && row.grams >= 20 && row.grams <= 5000 && row.pricePerKg != null);

  const subject = subjectFromOfficial(officialSnapshot);

  const byBrand = summarize(market, row => row.brand)
    .sort((a, b) => b.skuCount - a.skuCount || (a.medianPricePerKg ?? Infinity) - (b.medianPricePerKg ?? Infinity));
  const byProduct = summarize(market, row => row.family)
    .sort((a, b) => b.skuCount - a.skuCount);
  const byFormat = summarize(market, row => `${row.family} · ${row.format}`)
    .sort((a, b) => {
      const familyCompare = a.key.localeCompare(b.key, "es");
      return familyCompare || b.skuCount - a.skuCount;
    });

  const marketByFamily = new Map(byProduct.map(row => [row.key, row]));
  const piwenPosition = subject.map(item => {
    const family = marketByFamily.get(item.family);
    return {
      family: item.family,
      product: item.name,
      format: item.format,
      piwenPrice: item.currentPrice,
      piwenPricePerKg: item.pricePerKg,
      marketMedianPerKg: family?.medianPricePerKg ?? null,
      priceIndex: percentileIndex(item.pricePerKg, family?.medianPricePerKg ?? null),
      marketSkuCount: family?.skuCount ?? 0,
      marketBrands: family?.brands ?? 0,
    };
  });

  const lastObservedAt = marketSnapshot?.observedAt
    ?? market.map(row => row.observedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
    ?? null;

  const topAssortment = byBrand[0] ?? null;
  const cheapestFamily = [...byProduct]
    .filter(row => row.medianPricePerKg != null)
    .sort((a, b) => (a.medianPricePerKg ?? Infinity) - (b.medianPricePerKg ?? Infinity))[0] ?? null;

  const insights: string[] = [];
  if (topAssortment) insights.push(`${topAssortment.key} lidera el surtido competitivo observado con ${topAssortment.skuCount} SKU en ${topAssortment.retailers} retailer(s).`);
  const premium = piwenPosition.filter(row => (row.priceIndex ?? 0) > 105).sort((a, b) => (b.priceIndex ?? 0) - (a.priceIndex ?? 0))[0];
  if (premium) insights.push(`La mayor señal de premium de Piwén aparece en ${premium.family}: índice ${premium.priceIndex} vs mediana de mercado = 100.`);
  const value = piwenPosition.filter(row => (row.priceIndex ?? Infinity) < 95).sort((a, b) => (a.priceIndex ?? Infinity) - (b.priceIndex ?? Infinity))[0];
  if (value) insights.push(`Piwén aparece más competitivo en ${value.family}: índice ${value.priceIndex} vs mediana de mercado = 100.`);
  if (cheapestFamily) insights.push(`${cheapestFamily.key} presenta la menor mediana de precio por kilo dentro del universo comparable: $${new Intl.NumberFormat("es-CL").format(cheapestFamily.medianPricePerKg ?? 0)}/kg.`);
  if (!market.length) insights.push("No hay observaciones competitivas de supermercado disponibles en Supabase para el filtro vigente.");
  if (!subject.length) insights.push("No hay un snapshot oficial de Piwén.cl disponible para construir la posición propia.");

  const degraded = !market.length || !subject.length;

  return {
    source: "supabase" as const,
    generatedAt: new Date().toISOString(),
    lastObservedAt,
    scope: {
      market: "Chile",
      retailers: [...new Set(market.map(row => row.retailer))].sort(),
      families: [...new Set(market.map(row => row.family))].sort(),
    },
    kpis: {
      competitorBrands: new Set(market.map(row => row.brand)).size,
      marketSkus: market.length,
      retailers: new Set(market.map(row => row.retailer)).size,
      families: new Set(market.map(row => row.family)).size,
      formats: new Set(market.map(row => row.format)).size,
      promotedSkus: market.filter(row => (row.promotionPct ?? 0) > 0).length,
    },
    subject,
    piwenPosition,
    byBrand,
    byProduct,
    byFormat,
    listings: [...market]
      .sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""))
      .slice(0, 600),
    insights,
    note: degraded
      ? "Fuente Supabase. El panel conserva la información disponible sin inventar referencias antiguas; una fuente está temporalmente incompleta."
      : "Fuente Supabase. Mercado competitivo desde el último estado de supermercados monitoreados y Piwén desde el snapshot oficial de Piwén.cl. MercadoLibre se mantiene como canal separado.",
    degraded,
  };
}
