import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHousePing } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  if (!clickHouseConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      source: "clickhouse",
    }, { status: 503 });
  }

  try {
    const ping = await clickHousePing();
    return NextResponse.json({
      ok: ping?.ok === 1,
      configured: true,
      database: ping?.database_name ?? null,
      source: "clickhouse",
    }, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      configured: true,
      source: "clickhouse",
    }, { status: 503 });
  }
}
