import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseInsight } from "@/lib/clickhouse-insights";
import { clickHouseInsightV2, insightV2BrandOptions, insightV2ProductOptions, type InsightV2Mode } from "@/lib/clickhouse-insights-v2";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const V2_MODES = new Set<InsightV2Mode>(["price-evolution","price-gaps","price-alerts","products","data-status"]);
function days(value:string|null){const n=Number(value??30);return[7,30,90,180].includes(n)?n:30}

export async function GET(request:NextRequest){
  const auth=await enterpriseAccess(request,"overview");
  if(auth.response)return auth.response;
  if(!auth.access)return NextResponse.json({error:"No fue posible resolver el acceso enterprise."},{status:500});
  if(!clickHouseConfigured())return NextResponse.json({error:"ClickHouse no está configurado.",source:"clickhouse"},{status:503});
  const p=request.nextUrl.searchParams;
  try{
    if(p.get("options")==="brands")return NextResponse.json({source:"clickhouse",brands:await insightV2BrandOptions(auth.access)},{headers:{"cache-control":"private, max-age=300, stale-while-revalidate=900"}});
    if(p.get("options")==="products")return NextResponse.json({source:"clickhouse",products:await insightV2ProductOptions(auth.access,p.get("brand")??"",days(p.get("days")))},{headers:{"cache-control":"private, max-age=60, stale-while-revalidate=180"}});
    const raw=(p.get("mode")??"price-evolution") as InsightV2Mode;
    if(V2_MODES.has(raw)){
      const payload=await clickHouseInsightV2(auth.access,raw,{brand:p.get("brand"),productId:p.get("productId"),query:p.get("q"),days:days(p.get("days")),page:Number(p.get("page")??1),pageSize:Number(p.get("pageSize")??60)});
      return NextResponse.json(payload,{headers:{"cache-control":"private, max-age=20, stale-while-revalidate=90"}});
    }
    const legacyMode=p.get("mode")==="market-coverage"?"market-coverage":"retailer-benchmark";
    return NextResponse.json(await clickHouseInsight(auth.access,legacyMode,{brand:p.get("brand"),product:null,days:days(p.get("days"))}),{headers:{"cache-control":"private, max-age=30, stale-while-revalidate=120"}});
  }catch(error){console.error("clickhouse-insight-v2",error);return NextResponse.json({error:"No fue posible cargar el análisis desde ClickHouse.",source:"clickhouse"},{status:503});}
}
