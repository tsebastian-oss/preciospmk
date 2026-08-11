import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { productTrendBrands, productTrendProducts, productTrendSeries } from "@/lib/clickhouse-product-trends";

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
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado.", source: "clickhouse" }, { status: 503 });

  const mode = request.nextUrl.searchParams.get("mode") ?? "brands";
  try {
    if (mode === "brands") {
      return NextResponse.json({ source: "clickhouse", brands: await productTrendBrands(authorization.access) }, { headers: { "cache-control": "private, no-store, max-age=0" } });
    }
    if (mode === "products") {
      const brand = request.nextUrl.searchParams.get("brand") ?? "";
      return NextResponse.json({ source: "clickhouse", products: await productTrendProducts(authorization.access, brand) }, { headers: { "cache-control": "private, no-store, max-age=0" } });
    }
    if (mode === "series") {
      const ids = request.nextUrl.searchParams.getAll("product").slice(0, 4);
      return NextResponse.json({ source: "clickhouse", series: await productTrendSeries(authorization.access, ids, period(request.nextUrl.searchParams.get("days"))) }, { headers: { "cache-control": "private, no-store, max-age=0" } });
    }
    return NextResponse.json({ error: "Modo no soportado." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "No fue posible cargar la comparación de productos desde ClickHouse.", source: "clickhouse" }, { status: 503 });
  }
}
