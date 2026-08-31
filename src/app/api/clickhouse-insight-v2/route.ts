import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseInsight } from "@/lib/clickhouse-insights";
import {
  clickHouseInsightV2,
  insightV2BrandOptions,
  insightV2ProductOptions,
  type InsightV2Mode,
} from "@/lib/clickhouse-insights-v2";
import { fullHistoryEvolution } from "@/lib/clickhouse-full-history-evolution";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const V2 = new Set<InsightV2Mode>(["price-evolution", "price-gaps", "price-alerts", "products", "data-status"]);

function days(value: string | null) {
  const parsed = Number(value ?? 30);
  return [7, 30, 90, 180].includes(parsed) ? parsed : 30;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) {
    return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  }
  if (!clickHouseConfigured()) {
    return NextResponse.json({ error: "ClickHouse no está configurado.", source: "clickhouse" }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;

  try {
    if (params.get("options") === "brands") {
      return NextResponse.json(
        { source: "clickhouse", brands: await insightV2BrandOptions(authorization.access) },
        { headers: { "cache-control": "private, max-age=300, stale-while-revalidate=900" } },
      );
    }

    if (params.get("options") === "products") {
      return NextResponse.json(
        {
          source: "clickhouse",
          products: await insightV2ProductOptions(
            authorization.access,
            params.get("brand") ?? "",
            days(params.get("days")),
          ),
        },
        { headers: { "cache-control": "private, max-age=120, stale-while-revalidate=300" } },
      );
    }

    const mode = (params.get("mode") ?? "price-evolution") as InsightV2Mode;
    const filters = {
      brand: params.get("brand"),
      productId: params.get("productId"),
      days: days(params.get("days")),
    };

    // The aggregated evolution view uses the compact daily table so opening
    // the screen does not scan the full raw observation history. Only an
    // explicitly selected SKU needs the raw history path.
    if (mode === "price-evolution" && filters.productId) {
      return NextResponse.json(
        {
          source: "clickhouse",
          mode,
          generatedAt: new Date().toISOString(),
          ...await fullHistoryEvolution(authorization.access, filters),
        },
        { headers: { "cache-control": "private, max-age=30, stale-while-revalidate=120" } },
      );
    }

    if (V2.has(mode)) {
      return NextResponse.json(
        await clickHouseInsightV2(authorization.access, mode, {
          ...filters,
          query: params.get("q"),
          page: Number(params.get("page") ?? 1),
          pageSize: Number(params.get("pageSize") ?? 60),
        }),
        { headers: { "cache-control": "private, max-age=30, stale-while-revalidate=120" } },
      );
    }

    const legacy = params.get("mode") === "market-coverage" ? "market-coverage" : "retailer-benchmark";
    return NextResponse.json(
      await clickHouseInsight(authorization.access, legacy, {
        brand: params.get("brand"),
        product: null,
        days: days(params.get("days")),
      }),
      { headers: { "cache-control": "private, max-age=60, stale-while-revalidate=180" } },
    );
  } catch (error) {
    console.error("clickhouse-insight-v2", error);
    return NextResponse.json(
      { error: "No fue posible cargar el análisis desde ClickHouse.", source: "clickhouse" },
      { status: 503 },
    );
  }
}
