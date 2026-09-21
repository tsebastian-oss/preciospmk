import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseReadRpc } from "@/lib/enterprise-auth";
import { victorinoxMarketFromRows, type RawRow } from "@/lib/victorinox-market";
import { mergeVictorinoxOfficialMarket } from "@/lib/victorinox-real-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }

  const [light,competition] = await Promise.all([
    enterpriseReadRpc<Record<string,unknown>>(request,"brands_vertical_light_payload",{p_slug:"victorinox"}),
    enterpriseReadRpc<RawRow[]>(request,"victorinox_competition_market_payload",{p_limit_per_brand:250}),
  ]);
  if(light.response||!light.data)return light.response??NextResponse.json({error:"No fue posible cargar el catálogo oficial."},{status:503});
  if(competition.response||!Array.isArray(competition.data))return competition.response??NextResponse.json({error:"No fue posible cargar la competencia real."},{status:503});

  const base=victorinoxMarketFromRows(competition.data);
  const payload=mergeVictorinoxOfficialMarket(base,light.data);
  console.info("victorinox-market-ready",{ownSkus:payload.kpis.ownSkus,marketSkus:payload.kpis.marketSkus,competitorBrands:payload.kpis.competitorBrands,retailers:payload.kpis.retailers});
  return NextResponse.json({...payload,vertical:light.data},{
    headers:{"cache-control":"private, no-store, max-age=0","x-data-mode":"real","x-competition-source":"supabase-snapshot"},
  });
}
