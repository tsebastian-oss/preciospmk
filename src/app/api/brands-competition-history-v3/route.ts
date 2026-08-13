import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Numeric = number | string;
type HistoryRow = {
  category: string;
  brand: string;
  date: string;
  median_price: Numeric;
  products: Numeric;
};

const WATCH_BRANDS = ["victorinox", "tissot", "seiko", "citizen"];
const LUGGAGE_BRANDS = ["victorinox", "samsonite", "american tourister", "saxoline"];
const KNIFE_BRANDS = ["victorinox", "arcos", "global", "zwilling", "tramontina", "wusthof", "wüsthof"];
const ALL_BRANDS = [...new Set([...WATCH_BRANDS, ...LUGGAGE_BRANDS, ...KNIFE_BRANDS])];

const watchSignal = "(positionCaseInsensitiveUTF8(txt,'reloj')>0 OR positionCaseInsensitiveUTF8(txt,'watch')>0)";
const luggageSignal = "(positionCaseInsensitiveUTF8(txt,'maleta')>0 OR positionCaseInsensitiveUTF8(txt,'equipaje')>0 OR positionCaseInsensitiveUTF8(txt,'luggage')>0 OR positionCaseInsensitiveUTF8(txt,'suitcase')>0 OR positionCaseInsensitiveUTF8(txt,'spinner')>0 OR positionCaseInsensitiveUTF8(txt,'trolley')>0 OR positionCaseInsensitiveUTF8(txt,'carry-on')>0 OR positionCaseInsensitiveUTF8(txt,'carry on')>0)";
const knifeSignal = "(positionCaseInsensitiveUTF8(txt,'cuchill')>0 OR positionCaseInsensitiveUTF8(txt,'cuchiller')>0 OR positionCaseInsensitiveUTF8(txt,'knife')>0 OR positionCaseInsensitiveUTF8(txt,'santoku')>0 OR positionCaseInsensitiveUTF8(txt,'mondador')>0 OR positionCaseInsensitiveUTF8(txt,'paring')>0)";

const quoted = (values: string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
const categorySql = `multiIf(
  b IN (${quoted(WATCH_BRANDS)}) AND ${watchSignal}, 'Relojes',
  b IN (${quoted(LUGGAGE_BRANDS)}) AND ${luggageSignal}, 'Maletas',
  b IN (${quoted(KNIFE_BRANDS)}) AND ${knifeSignal}, 'Cuchillos',
  ''
)`;

function numberValue(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no configurado" }, { status: 503 });

  const requestedDays = Number(request.nextUrl.searchParams.get("days") || 90);
  const days = [30, 90, 180].includes(requestedDays) ? requestedDays : 90;
  const params: ClickHouseParams = { days_back: { type: "UInt16", value: days - 1 } };

  try {
    const rows = await clickHouseQuery<HistoryRow>(`
      SELECT
        category,
        brand,
        toString(price_date) AS date,
        round(quantileTDigest(0.5)(effective_price), 0) AS median_price,
        uniqExact(product_id) AS products
      FROM (
        SELECT
          ${categorySql} AS category,
          b AS brand,
          d.product_id,
          d.price_date,
          toFloat64(d.effective_price) AS effective_price
        FROM daily_pricing_live AS d FINAL
        INNER JOIN products AS p FINAL ON p.id = d.product_id
        CROSS JOIN (
          SELECT
            lowerUTF8(ifNull(p.brand, '')) AS b,
            concat(ifNull(p.name,''), ' ', ifNull(p.category,''), ' ', ifNull(p.smart_category,'')) AS txt
        )
        WHERE lowerUTF8(ifNull(p.brand, '')) IN (${quoted(ALL_BRANDS)})
          AND d.effective_price > 0
          AND d.price_date >= subtractDays(toDate(now(), 'America/Santiago'), {days_back:UInt16})
      )
      WHERE category != ''
      GROUP BY category, brand, price_date
      ORDER BY category, price_date, brand
    `, params, 9_000);

    const result = ["Relojes", "Maletas", "Cuchillos"].map((category) => {
      const categoryRows = rows.filter((row) => row.category === category);
      const dates = [...new Set(categoryRows.map((row) => row.date))].sort();
      const points = dates.flatMap((date) => {
        const dayRows = categoryRows.filter((row) => row.date === date);
        const own = dayRows.find((row) => row.brand === "victorinox");
        const competitors = dayRows.filter((row) => row.brand !== "victorinox" && numberValue(row.median_price) > 0);
        if (!own || !competitors.length) return [];
        const ownMedian = numberValue(own.median_price);
        const benchmarkMedian = median(competitors.map((row) => numberValue(row.median_price)));
        if (!ownMedian || !benchmarkMedian) return [];
        const priceIndex = ownMedian / benchmarkMedian * 100;
        return [{
          date,
          ownMedian: Math.round(ownMedian),
          benchmarkMedian: Math.round(benchmarkMedian),
          priceIndex: round1(priceIndex),
          premiumPct: round1(priceIndex - 100),
          ownProducts: numberValue(own.products),
          competitorProducts: competitors.reduce((sum, row) => sum + numberValue(row.products), 0),
          competitorBrands: competitors.length,
        }];
      });
      return { category, points };
    });

    return NextResponse.json({
      source: "clickhouse",
      brand: "Victorinox",
      days,
      categories: result,
      method: "daily_median_vs_median_of_competitor_brand_medians",
    }, { headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("brands competition history", error);
    return NextResponse.json({ error: "No fue posible calcular la evolución competitiva" }, { status: 503 });
  }
}
