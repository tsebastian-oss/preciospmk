import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

type Numeric = number | string;
type HistoryRow = { category: string; brand: string; date: string; median_price: Numeric; products: Numeric };

const WATCH = ["victorinox", "tissot", "seiko", "citizen"];
const LUGGAGE = ["victorinox", "samsonite", "american tourister", "saxoline"];
const KNIVES = ["victorinox", "arcos", "global", "zwilling", "tramontina", "wusthof", "wüsthof"];
const ALL = [...new Set([...WATCH, ...LUGGAGE, ...KNIVES])];
const quoted = (values: string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");

const watchSignal = "(positionCaseInsensitiveUTF8(txt,'reloj')>0 OR positionCaseInsensitiveUTF8(txt,'watch')>0)";
const luggageSignal = "(positionCaseInsensitiveUTF8(txt,'maleta')>0 OR positionCaseInsensitiveUTF8(txt,'equipaje')>0 OR positionCaseInsensitiveUTF8(txt,'luggage')>0 OR positionCaseInsensitiveUTF8(txt,'suitcase')>0 OR positionCaseInsensitiveUTF8(txt,'spinner')>0 OR positionCaseInsensitiveUTF8(txt,'trolley')>0 OR positionCaseInsensitiveUTF8(txt,'carry-on')>0 OR positionCaseInsensitiveUTF8(txt,'carry on')>0)";
const knifeSignal = "(positionCaseInsensitiveUTF8(txt,'cuchill')>0 OR positionCaseInsensitiveUTF8(txt,'cuchiller')>0 OR positionCaseInsensitiveUTF8(txt,'knife')>0 OR positionCaseInsensitiveUTF8(txt,'santoku')>0 OR positionCaseInsensitiveUTF8(txt,'mondador')>0 OR positionCaseInsensitiveUTF8(txt,'paring')>0)";
const categoryExpr = `multiIf(b IN (${quoted(WATCH)}) AND ${watchSignal},'Relojes',b IN (${quoted(LUGGAGE)}) AND ${luggageSignal},'Maletas',b IN (${quoted(KNIVES)}) AND ${knifeSignal},'Cuchillos','')`;

function n(value: Numeric | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function median(values: number[]) { if (!values.length) return 0; const s = [...values].sort((a,b)=>a-b), m = Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function round1(value: number) { return Math.round(value * 10) / 10; }

export async function handleBrandsCompetitionHistory(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no configurado" }, { status: 503 });
  const requested = Number(request.nextUrl.searchParams.get("days") || 90);
  const days = [30, 90, 180].includes(requested) ? requested : 90;
  const params: ClickHouseParams = { days_back: { type: "UInt16", value: days - 1 } };

  try {
    const rows = await clickHouseQuery<HistoryRow>(`
      SELECT category, brand, toString(price_date) date,
        round(quantileTDigest(0.5)(effective_price),0) median_price,
        uniqExact(product_id) products
      FROM (
        SELECT ${categoryExpr} category, b brand, product_id, price_date, effective_price
        FROM (
          SELECT d.product_id product_id, d.price_date price_date,
            toFloat64(d.effective_price) effective_price,
            lowerUTF8(ifNull(p.brand,'')) b,
            concat(ifNull(p.name,''),' ',ifNull(p.category,''),' ',ifNull(p.smart_category,'')) txt
          FROM daily_pricing_live d FINAL
          INNER JOIN products p FINAL ON p.id=d.product_id
          WHERE lowerUTF8(ifNull(p.brand,'')) IN (${quoted(ALL)})
            AND d.effective_price>0
            AND d.price_date>=subtractDays(toDate(now(),'America/Santiago'),{days_back:UInt16})
        )
      )
      WHERE category!=''
      GROUP BY category,brand,price_date
      ORDER BY category,price_date,brand
    `, params, 9_000);

    const categories = ["Relojes", "Maletas", "Cuchillos"].map((category) => {
      const byDate = new Map<string, HistoryRow[]>();
      rows.forEach((row) => { if(row.category!==category)return; const value=byDate.get(row.date)??[]; value.push(row); byDate.set(row.date,value); });
      const points = [...byDate.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([date, day]) => {
        const own = day.find((row)=>row.brand==="victorinox");
        const competitors = day.filter((row)=>row.brand!=="victorinox"&&n(row.median_price)>0);
        if(!own||!competitors.length)return [];
        const ownMedian=n(own.median_price), benchmark=median(competitors.map((row)=>n(row.median_price)));
        if(!ownMedian||!benchmark)return [];
        const index=ownMedian/benchmark*100;
        return [{date,ownMedian:Math.round(ownMedian),benchmarkMedian:Math.round(benchmark),priceIndex:round1(index),premiumPct:round1(index-100),ownProducts:n(own.products),competitorProducts:competitors.reduce((sum,row)=>sum+n(row.products),0),competitorBrands:competitors.length}];
      });
      return { category, points };
    });

    return NextResponse.json({source:"clickhouse",brand:"Victorinox",days,categories,method:"daily_median_vs_median_of_competitor_brand_medians"},{headers:{"cache-control":"private, max-age=60, stale-while-revalidate=300"}});
  } catch (error) {
    console.error("brands competition history", error);
    return NextResponse.json({ error: "No fue posible calcular la evolución competitiva" }, { status: 503 });
  }
}
