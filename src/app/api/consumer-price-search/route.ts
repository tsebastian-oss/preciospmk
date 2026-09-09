import { NextRequest, NextResponse } from "next/server";
import { clickHouseConfigured, clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

type RawPriceRow = {
  id: string;
  retailer: string | null;
  brand: string | null;
  name: string;
  url: string | null;
  regular_price: number | string | null;
  offer_price: number | string | null;
  in_stock: boolean | number | string;
  observed_at: string | null;
};

type ConsumerPriceResult = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  currentPrice: number;
  regularPrice: number | null;
  offerPrice: number | null;
  discountPct: number | null;
  inStock: boolean;
  observedAt: string | null;
  url: string | null;
};

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: boolean | number | string) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  if (query.length < 2) {
    return NextResponse.json({
      query,
      results: [],
      summary: null,
      message: "Escribe al menos 2 caracteres para comparar precios.",
    });
  }

  if (!clickHouseConfigured()) {
    return NextResponse.json(
      { query, results: [], summary: null, message: "El comparador está temporalmente sin conexión." },
      { status: 503 },
    );
  }

  const params: ClickHouseParams = {
    query: { type: "String", value: query },
  };

  try {
    const rows = await clickHouseQuery<RawPriceRow>(`
      SELECT
        toString(p.id) AS id,
        p.supermarket AS retailer,
        p.brand AS brand,
        p.name AS name,
        p.url AS url,
        toFloat64(ifNull(s.regular_price, 0)) AS regular_price,
        toFloat64(ifNull(s.offer_price, 0)) AS offer_price,
        s.in_stock AS in_stock,
        toString(s.observed_at) AS observed_at
      FROM products AS p FINAL
      INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
      WHERE p.retailer_type = 'supermarket'
        AND s.observed_at >= now() - INTERVAL 45 DAY
        AND positionCaseInsensitiveUTF8(
          concat(ifNull(p.brand, ''), ' ', ifNull(p.name, '')),
          {query:String}
        ) > 0
        AND if(
          toFloat64(ifNull(s.offer_price, 0)) > 0,
          toFloat64(s.offer_price),
          toFloat64(ifNull(s.regular_price, 0))
        ) > 0
      ORDER BY
        s.in_stock DESC,
        if(
          toFloat64(ifNull(s.offer_price, 0)) > 0,
          toFloat64(s.offer_price),
          toFloat64(ifNull(s.regular_price, 0))
        ) ASC,
        s.observed_at DESC
      LIMIT 80
    `, params, 8_000);

    const seen = new Set<string>();
    const results: ConsumerPriceResult[] = [];

    for (const row of rows) {
      const regularPrice = numberValue(row.regular_price) || null;
      const offerPrice = numberValue(row.offer_price) || null;
      const currentPrice = offerPrice && offerPrice > 0 ? offerPrice : regularPrice ?? 0;
      if (currentPrice <= 0) continue;

      const key = `${(row.retailer ?? "").toLowerCase()}::${(row.brand ?? "").toLowerCase()}::${row.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        id: row.id,
        retailer: (row.retailer ?? "Supermercado").trim() || "Supermercado",
        brand: (row.brand ?? "").trim(),
        name: row.name.trim(),
        currentPrice,
        regularPrice,
        offerPrice,
        discountPct:
          regularPrice && offerPrice && regularPrice > offerPrice
            ? Math.round(((regularPrice - offerPrice) / regularPrice) * 100)
            : null,
        inStock: boolValue(row.in_stock),
        observedAt: row.observed_at,
        url: row.url,
      });
    }

    const usable = results.filter((item) => item.inStock);
    const pool = usable.length ? usable : results;
    const prices = pool.map((item) => item.currentPrice).filter((price) => price > 0);
    const best = pool[0] ?? null;
    const medianPrice = median(prices);
    const maxPrice = prices.length ? Math.max(...prices) : null;

    const response = NextResponse.json({
      query,
      results: results.slice(0, 48),
      summary: best
        ? {
            bestPrice: best.currentPrice,
            bestRetailer: best.retailer,
            medianPrice,
            maxPrice,
            savingsVsMedian: medianPrice ? Math.max(0, medianPrice - best.currentPrice) : null,
            savingsVsMax: maxPrice ? Math.max(0, maxPrice - best.currentPrice) : null,
            stores: new Set(pool.map((item) => item.retailer)).size,
            matches: pool.length,
          }
        : null,
      message: results.length ? null : "No encontramos coincidencias recientes para esa búsqueda.",
    });

    response.headers.set("Cache-Control", "public, max-age=20, s-maxage=60, stale-while-revalidate=120");
    return response;
  } catch (error) {
    console.error("Consumer price search failed", {
      query,
      kind: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { query, results: [], summary: null, message: "No pudimos consultar precios en este momento." },
      { status: 502 },
    );
  }
}
