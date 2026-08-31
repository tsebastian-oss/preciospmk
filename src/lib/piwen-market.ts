import { clickHouseQuery } from "@/lib/clickhouse";
import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";

type RawRow = {
  id: string;
  retailer: string;
  brand: string | null;
  name: string;
  regular_price: number | string | null;
  offer_price: number | string | null;
  in_stock: boolean;
  observed_at: string | null;
  url: string;
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

const SUBJECT = [
  { id: "piwen-almendra-250", retailer: "Piwén.cl", brand: "Piwén", name: "Almendra natural 250 g", family: "Almendras", grams: 250, currentPrice: 5450, regularPrice: null, observedAt: "2026-08-28T14:30:00.000Z", url: "https://www.piwen.cl/" },
  { id: "piwen-caju-80", retailer: "Piwén.cl", brand: "Piwén", name: "Castañas de cajú sin sal 80 g", family: "Castañas de cajú", grams: 80, currentPrice: 2150, regularPrice: null, observedAt: "2026-08-28T14:30:00.000Z", url: "https://www.piwen.cl/" },
  { id: "piwen-caju-1k", retailer: "Piwén.cl", brand: "Piwén", name: "Castañas de cajú sin sal 1 kg", family: "Castañas de cajú", grams: 1000, currentPrice: 23800, regularPrice: null, observedAt: "2026-08-28T14:30:00.000Z", url: "https://www.piwen.cl/" },
  { id: "piwen-pistacho-80", retailer: "Piwén.cl", brand: "Piwén", name: "Pistacho sin sal 80 g", family: "Pistachos", grams: 80, currentPrice: 3150, regularPrice: null, observedAt: "2026-08-28T14:30:00.000Z", url: "https://www.piwen.cl/" },
  { id: "piwen-mix-1k", retailer: "Piwén.cl", brand: "Piwén", name: "Mix Aconcagua 1 kg", family: "Mixes", grams: 1000, currentPrice: 11800, regularPrice: null, observedAt: "2026-08-28T14:30:00.000Z", url: "https://www.piwen.cl/" },
] as const;

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

function currentPrice(row: RawRow) {
  const offer = Number(row.offer_price ?? 0);
  const regular = Number(row.regular_price ?? 0);
  return offer > 0 ? offer : regular > 0 ? regular : 0;
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

export async function piwenMarketIntelligence(_access: EnterpriseAccessContext) {
  const rows = await clickHouseQuery<RawRow>(`
    SELECT
      toString(p.id) AS id,
      p.supermarket AS retailer,
      p.brand AS brand,
      p.name AS name,
      toFloat64(ifNull(s.regular_price, 0)) AS regular_price,
      toFloat64(ifNull(s.offer_price, 0)) AS offer_price,
      s.in_stock AS in_stock,
      toString(s.observed_at) AS observed_at,
      p.url AS url
    FROM products AS p FINAL
    INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
    WHERE p.retailer_type = 'supermarket'
      AND (
        positionCaseInsensitiveUTF8(p.name, 'almendr') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'pistach') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'cajú') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'caju') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'cashew') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'nuez') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'maní') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'mani') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'avellana') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'frutos secos') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'semilla') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'cranber') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'pasa') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'ciruela deshidrat') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'damasco deshidrat') > 0
      )
      AND if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0))) > 0
    ORDER BY s.observed_at DESC
    LIMIT 3500
  `, {}, 12_000);

  const market: PiwenMarketListing[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const family = familyFor(row.name);
    if (!family || !isDirectComparable(row.name, family)) continue;
    const grams = gramsFor(row.name);
    const price = currentPrice(row);
    if (price <= 0) continue;
    const regularPrice = Number(row.regular_price ?? 0) > 0 ? Number(row.regular_price) : null;
    const promotionPct = regularPrice && regularPrice > price ? rounded((regularPrice - price) / regularPrice * 100, 1) : null;
    market.push({
      id: row.id,
      retailer: row.retailer,
      brand: cleanBrand(row.brand),
      name: row.name,
      family,
      grams,
      format: grams ? (grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000} kg` : `${grams} g`) : "Sin formato",
      currentPrice: price,
      regularPrice,
      pricePerKg: grams ? rounded(price * 1000 / grams) : null,
      promotionPct,
      inStock: Boolean(row.in_stock),
      observedAt: row.observed_at,
      url: row.url,
    });
  }

  const comparable = market.filter(row => row.grams && row.pricePerKg && row.grams >= 20 && row.grams <= 5000);

  const subject: PiwenMarketListing[] = SUBJECT.map(row => ({
    ...row,
    format: row.grams >= 1000 && row.grams % 1000 === 0 ? `${row.grams / 1000} kg` : `${row.grams} g`,
    regularPrice: row.regularPrice,
    pricePerKg: rounded(row.currentPrice * 1000 / row.grams),
    promotionPct: null,
    inStock: true,
  }));

  const byBrand = summarize(comparable, row => row.brand)
    .sort((a, b) => b.skuCount - a.skuCount || (a.medianPricePerKg ?? Infinity) - (b.medianPricePerKg ?? Infinity));
  const byProduct = summarize(comparable, row => row.family)
    .sort((a, b) => b.skuCount - a.skuCount);
  const byFormat = summarize(comparable, row => `${row.family} · ${row.format}`)
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

  const lastObservedAt = comparable
    .map(row => row.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

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

  return {
    source: "clickhouse" as const,
    generatedAt: new Date().toISOString(),
    lastObservedAt,
    scope: {
      market: "Chile",
      retailers: [...new Set(comparable.map(row => row.retailer))].sort(),
      families: [...new Set(comparable.map(row => row.family))].sort(),
    },
    kpis: {
      competitorBrands: new Set(comparable.map(row => row.brand)).size,
      marketSkus: comparable.length,
      retailers: new Set(comparable.map(row => row.retailer)).size,
      families: new Set(comparable.map(row => row.family)).size,
      formats: new Set(comparable.map(row => row.format)).size,
      promotedSkus: comparable.filter(row => (row.promotionPct ?? 0) > 0).length,
    },
    subject,
    piwenPosition,
    byBrand,
    byProduct,
    byFormat,
    listings: comparable
      .sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""))
      .slice(0, 600),
    insights,
    note: "Mercado competitivo: últimas observaciones de supermercados monitoreados. Referencias Piwén: demo pública observada el 28-08-2026; se puede conectar el crawler D2C para mantenerlas con la misma frecuencia.",
  };
}
