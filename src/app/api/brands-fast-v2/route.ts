import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseDashboard } from "@/lib/clickhouse-dashboard";
import { supabaseRest } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado." }, { status: 503 });
  const slug = request.nextUrl.searchParams.get("brand")?.trim().toLowerCase() || "victorinox";
  const brand = slug === "victorinox" ? "Victorinox" : slug;
  try {
    const started = Date.now();
    const [analytics, light] = await Promise.all([
      clickHouseDashboard(auth.access, { brand, days: 30 }),
      supabaseRest<any>("rpc/brands_vertical_light_payload", { method: "POST", body: { p_slug: slug } }),
    ]);
    const sourceMetrics = new Map(analytics.retailers.map((row) => [row.retailer.toLowerCase(), row]));
    const sources = (light?.sources ?? []).map((source:any) => {
      const metric = sourceMetrics.get(String(source.retailer_name ?? "").toLowerCase());
      return { ...source, listings: metric?.products ?? 0, in_stock: metric?.inStock ?? 0, min_price: null, max_price: null, last_crawled_at: metric?.lastObservedAt ?? source.last_crawled_at ?? null, last_status: metric ? "ok:clickhouse" : source.last_status ?? "configured" };
    });
    return NextResponse.json({
      source: "clickhouse",
      generatedAt: analytics.generatedAt,
      queryMs: Date.now() - started,
      brand: light?.brand ?? { slug, name: brand, countryCode: "CL", officialUrl: null },
      summary: { products: analytics.kpis.monitoredProducts, sources: analytics.kpis.retailers, listings: analytics.kpis.monitoredProducts, sellers: 0, inStockPct: analytics.kpis.availabilityPct, promoPct: analytics.kpis.promotionPct, lastObservedAt: analytics.kpis.lastObservedAt },
      sources,
      products: light?.products ?? [],
      listings: light?.listings ?? [],
      lastRun: light?.lastRun ?? null,
      analytics,
    }, { headers: { "cache-control": "private, max-age=15, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "No fue posible cargar Brands desde ClickHouse." }, { status: 503 });
  }
}
