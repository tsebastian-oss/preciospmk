import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";
import { victorinoxMarketFromRows, type RawRow } from "@/lib/victorinox-market";

type Numeric = number | string;
type HistoryRow = { category: string; brand: string; date: string; median_price: Numeric; products: Numeric };
type OfficialHistoryRow = { category: string; date: string; median_price: Numeric; products: Numeric };

const WATCH = ["victorinox", "tissot", "seiko", "citizen"];
const LUGGAGE = ["victorinox", "samsonite", "american tourister", "saxoline"];
const TOOLS = ["victorinox", "leatherman"];
const KNIVES = ["victorinox", "arcos", "global", "zwilling", "tramontina", "wusthof", "wüsthof"];
const ALL = [...new Set([...WATCH, ...LUGGAGE, ...TOOLS, ...KNIVES])];
const quoted = (values: string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");

const watchSignal = "(positionCaseInsensitiveUTF8(txt,'reloj')>0 OR positionCaseInsensitiveUTF8(txt,'watch')>0)";
const watchAccessory = "(startsWith(lowerUTF8(trimBoth(txt)),'correa ') OR startsWith(lowerUTF8(trimBoth(txt)),'pulsera ') OR startsWith(lowerUTF8(trimBoth(txt)),'brazalete ') OR startsWith(lowerUTF8(trimBoth(txt)),'protector ') OR startsWith(lowerUTF8(trimBoth(txt)),'estuche '))";
const luggageSignal = "(positionCaseInsensitiveUTF8(txt,'maleta')>0 OR positionCaseInsensitiveUTF8(txt,'equipaje')>0 OR positionCaseInsensitiveUTF8(txt,'luggage')>0 OR positionCaseInsensitiveUTF8(txt,'suitcase')>0 OR positionCaseInsensitiveUTF8(txt,'spinner')>0 OR positionCaseInsensitiveUTF8(txt,'trolley')>0 OR positionCaseInsensitiveUTF8(txt,'carry-on')>0 OR positionCaseInsensitiveUTF8(txt,'carry on')>0)";
const pocketSignal = "(positionCaseInsensitiveUTF8(txt,'navaj')>0 OR positionCaseInsensitiveUTF8(txt,'cortapluma')>0 OR positionCaseInsensitiveUTF8(txt,'swisstool')>0 OR positionCaseInsensitiveUTF8(txt,'swiss champ')>0 OR positionCaseInsensitiveUTF8(txt,'spartan')>0 OR positionCaseInsensitiveUTF8(txt,'huntsman')>0 OR positionCaseInsensitiveUTF8(txt,'classic sd')>0 OR positionCaseInsensitiveUTF8(txt,'ranger grip')>0 OR positionCaseInsensitiveUTF8(txt,'cybertool')>0 OR positionCaseInsensitiveUTF8(txt,'work champ')>0 OR positionCaseInsensitiveUTF8(txt,'skeletool')>0 OR positionCaseInsensitiveUTF8(txt,'leatherman wave')>0 OR positionCaseInsensitiveUTF8(txt,'leatherman signal')>0 OR positionCaseInsensitiveUTF8(txt,'leatherman surge')>0 OR positionCaseInsensitiveUTF8(txt,'leatherman rebar')>0)";
const pocketAccessory = "(positionCaseInsensitiveUTF8(txt,'aceite')>0 OR positionCaseInsensitiveUTF8(txt,'cadena para navaj')>0 OR positionCaseInsensitiveUTF8(txt,'cordón para navaj')>0 OR positionCaseInsensitiveUTF8(txt,'cordon para navaj')>0 OR positionCaseInsensitiveUTF8(txt,'lanyard')>0 OR positionCaseInsensitiveUTF8(txt,'multiclip')>0 OR positionCaseInsensitiveUTF8(txt,'alfiler repuesto')>0 OR positionCaseInsensitiveUTF8(txt,'multiherramientas para navajas')>0 OR positionCaseInsensitiveUTF8(txt,'juguete')>0)";
const knifeSignal = "(positionCaseInsensitiveUTF8(txt,'cuchill')>0 OR positionCaseInsensitiveUTF8(txt,'cuchiller')>0 OR positionCaseInsensitiveUTF8(txt,'knife')>0 OR positionCaseInsensitiveUTF8(txt,'santoku')>0 OR positionCaseInsensitiveUTF8(txt,'mondador')>0 OR positionCaseInsensitiveUTF8(txt,'paring')>0 OR positionCaseInsensitiveUTF8(txt,'chef')>0 OR positionCaseInsensitiveUTF8(txt,'trinchar')>0 OR positionCaseInsensitiveUTF8(txt,'filetear')>0)";
const knifeAccessory = "(positionCaseInsensitiveUTF8(txt,'pelador')>0 OR positionCaseInsensitiveUTF8(txt,'rallador')>0 OR positionCaseInsensitiveUTF8(txt,'tabla de corte')>0 OR positionCaseInsensitiveUTF8(txt,'tijera')>0 OR positionCaseInsensitiveUTF8(txt,'cuchara')>0 OR positionCaseInsensitiveUTF8(txt,'tenedor')>0 OR positionCaseInsensitiveUTF8(txt,'afilador')>0 OR positionCaseInsensitiveUTF8(txt,'soporte')>0 OR positionCaseInsensitiveUTF8(txt,'olla')>0 OR positionCaseInsensitiveUTF8(txt,'sarten')>0 OR positionCaseInsensitiveUTF8(txt,'sartén')>0)";
const categoryExpr = `multiIf(
  b IN (${quoted(WATCH)}) AND ${watchSignal} AND NOT ${watchAccessory},'Relojes',
  b IN (${quoted(LUGGAGE)}) AND ${luggageSignal},'Equipo de viaje',
  b IN (${quoted(TOOLS)}) AND ${pocketSignal} AND NOT ${pocketAccessory},'Navajas y multiherramientas',
  b IN (${quoted(KNIVES)}) AND ${knifeSignal} AND NOT ${knifeAccessory},'Cuchillos',
  '')`;

function n(value: Numeric | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function median(values: number[]) { if (!values.length) return 0; const s = [...values].sort((a,b)=>a-b), m = Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function round1(value: number) { return Math.round(value * 10) / 10; }

async function handleCompetitionHistory(request: NextRequest, moduleName: "overview" | "brand-panel", requireVictorinoxScope = false) {
  const auth = await enterpriseAccess(request, moduleName);
  if (auth.response) return auth.response;
  if (requireVictorinoxScope && (!auth.access || !brandScopeAllows(auth.access, "victorinox"))) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }
  const requested = Number(request.nextUrl.searchParams.get("days") || 90);
  const days = [30, 90, 180].includes(requested) ? requested : 90;
  const params: ClickHouseParams = { days_back: { type: "UInt16", value: days - 1 } };
  let officialHistory: OfficialHistoryRow[] = [];
  if (requireVictorinoxScope) {
    const official = await enterpriseRpc<OfficialHistoryRow[]>(request, "brands_vertical_official_history", { p_slug: "victorinox", p_days: days });
    if (official.response) return official.response;
    officialHistory = Array.isArray(official.data) ? official.data : [];
    console.info("victorinox-history-supabase", { days, points: officialHistory.length });
  }

  if (!clickHouseConfigured()) {
    return NextResponse.json({ error: "Histórico real no disponible: ClickHouse no está configurado." }, { status: 503 });
  }

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

    let marketSnapshot = null;
    if (requireVictorinoxScope) {
      const snapshot = await enterpriseRpc<RawRow[]>(request, "victorinox_competition_market_payload", { p_limit_per_brand: 250 });
      if (snapshot.response) return snapshot.response;
      marketSnapshot = victorinoxMarketFromRows(Array.isArray(snapshot.data) ? snapshot.data : []);
      console.info("victorinox-history-snapshot", {
        listings: marketSnapshot.listings.length,
        competitorBrands: marketSnapshot.kpis.competitorBrands,
        retailers: marketSnapshot.kpis.retailers,
      });
    }
    const categoryNames = ["Relojes", "Equipo de viaje", "Navajas y multiherramientas", "Cuchillos"];
    const categories = categoryNames.map((category) => {
      const competitorByDate = new Map<string, HistoryRow[]>();
      rows.forEach((row) => {
        if(row.category!==category||row.brand==="victorinox"||n(row.median_price)<=0)return;
        competitorByDate.set(row.date,[...(competitorByDate.get(row.date)??[]),row]);
      });

      if (requireVictorinoxScope) {
        const competitorDates=[...competitorByDate.keys()].sort();
        const points=officialHistory.filter(row=>row.category===category&&n(row.median_price)>0).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(own=>{
          let competitors=competitorByDate.get(own.date)??[];
          if(!competitors.length&&competitorDates.length){
            const target=new Date(own.date+"T12:00:00Z").getTime();
            const nearest=[...competitorDates].sort((a,b)=>Math.abs(new Date(a+"T12:00:00Z").getTime()-target)-Math.abs(new Date(b+"T12:00:00Z").getTime()-target))[0];
            const gap=Math.abs(new Date(nearest+"T12:00:00Z").getTime()-target)/86400000;
            if(gap<=7)competitors=competitorByDate.get(nearest)??[];
          }
          const snapshotPosition=(marketSnapshot as any)?.position?.find((item:any)=>item.category===category);
          const snapshotBenchmark=n(snapshotPosition?.benchmarkMedian);
          const benchmark=competitors.length?median(competitors.map(row=>n(row.median_price))):snapshotBenchmark;
          if(!benchmark)return [];
          const ownMedian=n(own.median_price),index=ownMedian/benchmark*100;
          const snapshotCompetitors:Array<any>=snapshotPosition?.competitors??[];
          return [{date:own.date,ownMedian:Math.round(ownMedian),benchmarkMedian:Math.round(benchmark),priceIndex:round1(index),premiumPct:round1(index-100),ownProducts:n(own.products),competitorProducts:competitors.length?competitors.reduce((sum,row)=>sum+n(row.products),0):snapshotCompetitors.reduce((sum:number,row:any)=>sum+n(row.skuCount),0),competitorBrands:competitors.length||snapshotCompetitors.length,benchmarkMode:competitors.length?"daily":"latest_observed"}];
        });
        return {category,points};
      }

      const byDate = new Map<string, HistoryRow[]>();
      rows.forEach((row)=>{if(row.category!==category)return;byDate.set(row.date,[...(byDate.get(row.date)??[]),row]);});
      const points=[...byDate.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([date,day])=>{
        const own=day.find(row=>row.brand==="victorinox"),competitors=day.filter(row=>row.brand!=="victorinox"&&n(row.median_price)>0);
        if(!own||!competitors.length)return [];
        const ownMedian=n(own.median_price),benchmark=median(competitors.map(row=>n(row.median_price)));
        if(!ownMedian||!benchmark)return [];
        const index=ownMedian/benchmark*100;
        return [{date,ownMedian:Math.round(ownMedian),benchmarkMedian:Math.round(benchmark),priceIndex:round1(index),premiumPct:round1(index-100),ownProducts:n(own.products),competitorProducts:competitors.reduce((sum,row)=>sum+n(row.products),0),competitorBrands:competitors.length}];
      });
      return {category,points};
    });

    console.info("brands-competition-history-ready",{source:requireVictorinoxScope?"supabase+clickhouse":"clickhouse",days,counts:categories.map(item=>({category:item.category,points:item.points.length}))});
    return NextResponse.json({source:requireVictorinoxScope?"supabase+clickhouse":"clickhouse",brand:"Victorinox",days,categories,method:"official_daily_median_vs_competitor_brand_medians"},{headers:{"cache-control":"private, max-age=60, stale-while-revalidate=300"}});
  } catch (error) {
    console.error("brands competition history", error);
    return NextResponse.json({ error: "No fue posible consultar el histórico real." }, { status: 503 });
  }
}


export async function handleBrandsCompetitionHistory(request: NextRequest) {
  return handleCompetitionHistory(request, "overview", false);
}

export async function handleVictorinoxCompetitionHistory(request: NextRequest) {
  return handleCompetitionHistory(request, "brand-panel", true);
}
