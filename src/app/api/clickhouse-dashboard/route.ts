import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseDashboard } from "@/lib/clickhouse-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function period(value: string | null) {
  const parsed = Number(value ?? 30);
  return [7, 30, 90].includes(parsed) ? parsed : 30;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });

  if (!clickHouseConfigured()) {
    return NextResponse.json({ error: "ClickHouse no está configurado.", source: "clickhouse" }, { status: 503 });
  }

  try {
    const payload = await clickHouseDashboard(authorization.access, {
      retailer: request.nextUrl.searchParams.get("retailer"),
      category: request.nextUrl.searchParams.get("category"),
      brand: request.nextUrl.searchParams.get("brand"),
      days: period(request.nextUrl.searchParams.get("days")),
    });

    return NextResponse.json(payload, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({
      error: "No fue posible cargar el dashboard desde ClickHouse.",
      source: "clickhouse",
    }, { status: 503 });
  }
}
