import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseDashboard } from "@/lib/clickhouse-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado." }, { status: 503 });
  const brand = request.nextUrl.searchParams.get("brand")?.trim() || "Victorinox";
  try {
    const analytics = await clickHouseDashboard(auth.access, { brand, days: 30 });
    return NextResponse.json({ source: "clickhouse", brand, analytics }, { headers: { "cache-control": "private, max-age=15, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "No fue posible cargar Brands desde ClickHouse." }, { status: 503 });
  }
}
