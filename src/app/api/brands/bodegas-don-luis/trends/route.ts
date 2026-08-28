import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrendPayload = {
  days?: number;
  bucketHours?: number;
  categories?: string[];
  chains?: string[];
  points?: Array<Record<string, unknown>>;
  lastCapturedAt?: string | null;
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "bodegas-don-luis")) {
    return NextResponse.json({ error: "Esta marca no está habilitada para tu cuenta." }, { status: 403 });
  }

  const rawDays = Number(request.nextUrl.searchParams.get("days") || 30);
  const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 30));

  const result = await enterpriseRpc<TrendPayload>(request, "brands_peru_liquor_trends", {
    p_slug: "bodegas-don-luis",
    p_days: days,
  });
  if (result.response) return result.response;
  if (!result.data) {
    return NextResponse.json({ error: "No fue posible cargar el histórico de precios." }, { status: 503 });
  }

  return NextResponse.json(result.data, {
    headers: { "cache-control": "private, max-age=60, stale-while-revalidate=180" },
  });
}
