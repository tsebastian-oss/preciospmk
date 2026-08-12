import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseAutomotiveCatalog, clickHouseAutomotiveOptions, clickHouseAutomotiveVariations } from "@/lib/clickhouse-automotive";
import { clickHouseAutomotiveBrandVariations, type AutomotiveBrandComparison } from "@/lib/clickhouse-automotive-brand";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado.", source: "clickhouse" }, { status: 503 });

  try {
    const params = request.nextUrl.searchParams;
    if (params.get("options") === "1") {
      const options = await clickHouseAutomotiveOptions(authorization.access);
      return NextResponse.json({ source: "clickhouse", ...options }, {
        headers: { "cache-control": "private, max-age=300, stale-while-revalidate=900" },
      });
    }

    const filters = {
      brand: params.get("brand"),
      model: params.get("model"),
      dealer: params.get("dealer"),
    };

    if (params.get("mode") === "variations") {
      const payload = await clickHouseAutomotiveVariations(authorization.access, filters);
      return NextResponse.json(payload, {
        headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" },
      });
    }

    if (params.get("mode") === "brand_variations") {
      const comparison: AutomotiveBrandComparison = params.get("comparison") === "previous_month"
        ? "previous_month"
        : "previous_week";
      const payload = await clickHouseAutomotiveBrandVariations(authorization.access, filters, comparison);
      return NextResponse.json(payload, {
        headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" },
      });
    }

    const payload = await clickHouseAutomotiveCatalog(authorization.access, filters);
    return NextResponse.json(payload, {
      headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "No fue posible cargar la inteligencia automotriz desde ClickHouse.", source: "clickhouse" }, { status: 503 });
  }
}
