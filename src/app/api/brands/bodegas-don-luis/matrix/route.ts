import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "bodegas-don-luis")) {
    return NextResponse.json({ error: "Esta marca no está habilitada para tu cuenta." }, { status: 403 });
  }

  const result = await enterpriseRpc<Record<string, unknown>>(request, "brands_peru_liquor_matrix", {
    p_slug: "bodegas-don-luis",
  });
  if (result.response) return result.response;
  if (!result.data) return NextResponse.json({ error: "No fue posible construir la comparación de cadenas." }, { status: 503 });

  return NextResponse.json(result.data, {
    headers: { "cache-control": "private, max-age=30, stale-while-revalidate=90" },
  });
}
