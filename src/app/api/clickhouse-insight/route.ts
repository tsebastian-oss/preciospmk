import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import {
  clickHouseBrandOptions,
  clickHouseInsight,
  clickHouseProductOptions,
  type ClickHouseInsightMode,
} from "@/lib/clickhouse-insights";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MODES = new Set<ClickHouseInsightMode>([
  "price-evolution",
  "retailer-benchmark",
  "market-coverage",
  "price-gaps",
  "price-alerts",
  "products",
  "data-status",
]);

function days(value: string | null) {
  const parsed = Number(value ?? 30);
  return [7, 30, 90].includes(parsed) ? parsed : 30;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado.", source: "clickhouse" }, { status: 503 });

  const params = request.nextUrl.searchParams;
  const optionMode = params.get("options");
  try {
    if (optionMode === "brands") {
      const brands = await clickHouseBrandOptions(authorization.access);
      return NextResponse.json({ source: "clickhouse", brands }, { headers: { "cache-control": "private, max-age=300, stale-while-revalidate=900" } });
    }
    if (optionMode === "products") {
      const brand = (params.get("brand") ?? "").trim();
      const products = await clickHouseProductOptions(authorization.access, brand);
      return NextResponse.json({ source: "clickhouse", products }, { headers: { "cache-control": "private, max-age=120, stale-while-revalidate=600" } });
    }

    const rawMode = params.get("mode") as ClickHouseInsightMode | null;
    const mode = rawMode && MODES.has(rawMode) ? rawMode : "price-evolution";
    const payload = await clickHouseInsight(authorization.access, mode, {
      brand: params.get("brand"),
      product: params.get("product"),
      days: days(params.get("days")),
    });
    return NextResponse.json(payload, {
      headers: { "cache-control": "private, max-age=30, stale-while-revalidate=120" },
    });
  } catch {
    return NextResponse.json({ error: "No fue posible cargar el análisis desde ClickHouse.", source: "clickhouse" }, { status: 503 });
  }
}
