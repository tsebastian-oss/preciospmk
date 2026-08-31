import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { piwenHistoryIntelligence } from "@/lib/piwen-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }
  if (!clickHouseConfigured()) {
    return NextResponse.json({ error: "ClickHouse no está disponible." }, { status: 503 });
  }

  try {
    const payload = await piwenHistoryIntelligence(authorization.access);
    return NextResponse.json(payload, {
      headers: { "cache-control": "private, max-age=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.error("piwen-history", error);
    return NextResponse.json({ error: "No fue posible cargar el histórico competitivo." }, { status: 503 });
  }
}
