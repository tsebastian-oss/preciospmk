import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { victorinoxMarketIntelligence } from "@/lib/victorinox-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está disponible." }, { status: 503 });

  try {
    const [market, light] = await Promise.all([
      victorinoxMarketIntelligence(authorization.access),
      enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_light_payload", { p_slug: "victorinox" }),
    ]);
    return NextResponse.json({
      ...market,
      vertical: light.response ? null : light.data ?? null,
    }, { headers: { "cache-control": "private, max-age=90, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("victorinox-market", error);
    return NextResponse.json({ error: "No fue posible cargar el mercado competitivo de Victorinox." }, { status: 503 });
  }
}
