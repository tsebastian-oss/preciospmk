import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { victorinoxMarketIntelligence } from "@/lib/victorinox-market";
import { victorinoxDemoMarket } from "@/lib/victorinox-demo-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }

  let vertical: Record<string, unknown> | null = null;
  try {
    const light = await enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_light_payload", { p_slug: "victorinox" });
    vertical = light.response ? null : light.data ?? null;
  } catch (error) {
    console.warn("victorinox-light-payload", error);
  }

  if (clickHouseConfigured()) {
    try {
      const market = await victorinoxMarketIntelligence(authorization.access);
      if (market.listings.length > 0 && market.position.some(item => item.own)) {
        return NextResponse.json({ ...market, demo: false, vertical }, { headers: { "cache-control": "private, max-age=90, stale-while-revalidate=300" } });
      }
      console.warn("victorinox-market-empty: using presentation fallback");
    } catch (error) {
      console.error("victorinox-market", error);
    }
  }

  return NextResponse.json({ ...victorinoxDemoMarket(), vertical }, {
    headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300", "x-demo-fallback": "victorinox" },
  });
}
