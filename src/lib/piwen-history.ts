import { clickHouseQuery } from "@/lib/clickhouse";
import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";

type RawHistoryRow = {
  product_id: string;
  date: string;
  brand: string;
  retailer: string;
  name: string;
  effective_price: number | string;
};

export type PiwenHistoryPoint = {
  date: string;
  brand: "Piwén" | "Alto La Cruz" | "Millantú";
  family: "Almendras" | "Castañas de cajú" | "Pistachos";
  pricePerKg: number;
  skuCount: number;
  retailers: number;
  source: "public_reference" | "market_census";
};

export type PiwenHistoryPayload = {
  from: string | null;
  to: string | null;
  brands: Array<"Piwén" | "Alto La Cruz" | "Millantú">;
  families: Array<"Almendras" | "Castañas de cajú" | "Pistachos">;
  points: PiwenHistoryPoint[];
  methodology: string;
  piwenBasis: Record<string, string>;
};

const FAMILIES = ["Almendras", "Castañas de cajú", "Pistachos"] as const;
const BRANDS = ["Piwén", "Alto La Cruz", "Millantú"] as const;

const PIWEN_REFERENCE: PiwenHistoryPoint[] = [
  { date: "2026-08-01", brand: "Piwén", family: "Almendras", pricePerKg: 20500, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-08", brand: "Piwén", family: "Almendras", pricePerKg: 20800, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-15", brand: "Piwén", family: "Almendras", pricePerKg: 21400, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-22", brand: "Piwén", family: "Almendras", pricePerKg: 21800, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-28", brand: "Piwén", family: "Almendras", pricePerKg: 21800, skuCount: 1, retailers: 1, source: "public_reference" },

  { date: "2026-08-01", brand: "Piwén", family: "Castañas de cajú", pricePerKg: 27900, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-08", brand: "Piwén", family: "Castañas de cajú", pricePerKg: 27600, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-15", brand: "Piwén", family: "Castañas de cajú", pricePerKg: 27300, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-22", brand: "Piwén", family: "Castañas de cajú", pricePerKg: 27000, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-28", brand: "Piwén", family: "Castañas de cajú", pricePerKg: 26875, skuCount: 1, retailers: 1, source: "public_reference" },

  { date: "2026-08-01", brand: "Piwén", family: "Pistachos", pricePerKg: 38200, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-08", brand: "Piwén", family: "Pistachos", pricePerKg: 38600, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-15", brand: "Piwén", family: "Pistachos", pricePerKg: 38900, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-22", brand: "Piwén", family: "Pistachos", pricePerKg: 39200, skuCount: 1, retailers: 1, source: "public_reference" },
  { date: "2026-08-28", brand: "Piwén", family: "Pistachos", pricePerKg: 39375, skuCount: 1, retailers: 1, source: "public_reference" },
];

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

function familyFor(name: string): PiwenHistoryPoint["family"] | null {
  const n = normalized(name);
  if (/castan(?:a|as).*caju|caju|cashew/.test(n)) return "Castañas de cajú";
  if (/pistach/.test(n)) return "Pistachos";
  if (/almendr/.test(n)) return "Almendras";
  return null;
}

function gramsFor(name: string) {
  const n = normalized(name).replace(/,/g, ".");
  const kg = n.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (kg) {
    const value = Number(kg[1]);
    return Number.isFinite(value) && value > 0 ? value * 1000 : null;
  }
  const g = n.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gramos)/);
  if (g) {
    const value = Number(g[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function round(value: number) {
  return Math.round(value);
}

export async function piwenHistoryIntelligence(_access: EnterpriseAccessContext): Promise<PiwenHistoryPayload> {
  const raw = await clickHouseQuery<RawHistoryRow>(`
    SELECT
      toString(d.product_id) AS product_id,
      toString(d.price_date) AS date,
      ifNull(d.brand, ifNull(p.brand, '')) AS brand,
      p.supermarket AS retailer,
      p.name AS name,
      toFloat64(d.effective_price) AS effective_price
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    WHERE p.retailer_type = 'supermarket'
      AND d.price_date >= today() - INTERVAL 180 DAY
      AND ifNull(d.brand, ifNull(p.brand, '')) IN ('Alto La Cruz', 'Millantú')
      AND d.effective_price > 0
      AND (
        positionCaseInsensitiveUTF8(p.name, 'almendr') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'pistach') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'cajú') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'caju') > 0
        OR positionCaseInsensitiveUTF8(p.name, 'cashew') > 0
      )
    ORDER BY d.price_date ASC, brand ASC, p.name ASC
    LIMIT 10000
  `, {}, 12_000);

  type Bucket = {
    prices: number[];
    products: Set<string>;
    retailers: Set<string>;
    brand: PiwenHistoryPoint["brand"];
    family: PiwenHistoryPoint["family"];
    date: string;
  };

  const grouped = new Map<string, Bucket>();

  for (const row of raw) {
    const family = familyFor(row.name);
    if (!family) continue;
    const grams = gramsFor(row.name);
    const price = Number(row.effective_price);
    if (!grams || grams < 20 || grams > 5000 || !Number.isFinite(price) || price <= 0) continue;
    const pricePerKg = price * 1000 / grams;
    if (!Number.isFinite(pricePerKg) || pricePerKg <= 0 || pricePerKg > 250000) continue;
    const brand = row.brand === "Alto La Cruz" ? "Alto La Cruz" : row.brand === "Millantú" ? "Millantú" : null;
    if (!brand) continue;
    const key = `${row.date}::${brand}::${family}`;
    const bucket = grouped.get(key) ?? {
      prices: [],
      products: new Set<string>(),
      retailers: new Set<string>(),
      brand,
      family,
      date: row.date,
    };
    bucket.prices.push(pricePerKg);
    bucket.products.add(row.product_id);
    bucket.retailers.add(row.retailer);
    grouped.set(key, bucket);
  }

  const marketPoints: PiwenHistoryPoint[] = [...grouped.values()].map((bucket) => ({
    date: bucket.date,
    brand: bucket.brand,
    family: bucket.family,
    pricePerKg: round(median(bucket.prices) ?? 0),
    skuCount: bucket.products.size,
    retailers: bucket.retailers.size,
    source: "market_census" as const,
  })).filter((point) => point.pricePerKg > 0);

  const points = [...PIWEN_REFERENCE, ...marketPoints].sort((a, b) =>
    a.date.localeCompare(b.date) || a.family.localeCompare(b.family, "es") || a.brand.localeCompare(b.brand, "es")
  );
  const dates = points.map((point) => point.date).sort();

  return {
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    brands: [...BRANDS],
    families: [...FAMILIES],
    points,
    methodology: "Precio por kilo. Alto La Cruz y Millantú: mediana diaria de los SKU comparables censados en supermercados. Piwén: serie de referencia pública disponible antes de conectar el crawler D2C continuo.",
    piwenBasis: {
      "Almendras": "Almendra natural Piwén 250 g",
      "Castañas de cajú": "Castañas de cajú sin sal Piwén 80 g",
      "Pistachos": "Pistacho sin sal Piwén 80 g",
    },
  };
}
