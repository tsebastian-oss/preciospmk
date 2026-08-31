import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { piwenMarketIntelligence } from "@/lib/piwen-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }
  if (!clickHouseConfigured()) {
    return NextResponse.json({ error: "ClickHouse no está disponible.", source: "clickhouse" }, { status: 503 });
  }

  try {
    const [payload, marketplaceResult] = await Promise.all([
      piwenMarketIntelligence(authorization.access),
      enterpriseRpc<Record<string, unknown>>(request, "brands_piwen_marketplace_snapshot", { p_slug: "piwen" }),
    ]);
    const marketplace = marketplaceResult.response ? null : marketplaceResult.data ?? null;
    return NextResponse.json({ ...payload, marketplace }, {
      headers: { "cache-control": "private, max-age=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("piwen-market", error);
    return NextResponse.json(
      { error: "No fue posible cargar el mercado competitivo de Piwén.", source: "clickhouse" },
      { status: 503 },
    );
  }
}
