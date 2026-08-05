import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, scopeAllows } from "@/lib/enterprise-auth";
import { supabaseRest } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ChangeRow = {
  id: number;
  crawl_run_id: number;
  previous_run_id: number | null;
  product_id: string;
  supermarket: string;
  external_id: string;
  change_type: string;
  changed_fields: string[] | Record<string, unknown> | null;
  previous_values: Record<string, unknown> | null;
  current_values: Record<string, unknown> | null;
  detected_at: string;
};

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inFilter(values: string[]) {
  const clean = values.map((item) => item.replace(/["(),]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return `in.(${clean.map((item) => `"${item}"`).join(",")})`;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "price-movements");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  try {
    const query: Record<string, string> = {
      select: "id,crawl_run_id,previous_run_id,product_id,supermarket,external_id,change_type,changed_fields,previous_values,current_values,detected_at",
      order: "detected_at.desc,id.desc",
      limit: "500",
    };
    if (!access.isSaasAdmin && access.retailers.length > 0) query.supermarket = inFilter(access.retailers);

    const changes = await supabaseRest<ChangeRow[]>("catalog_run_product_changes", { query });
    const enriched = changes.map((change) => {
      const previous = change.previous_values ?? {};
      const current = change.current_values ?? {};
      const previousPrice = numeric(previous.offer_price ?? previous.regular_price);
      const currentPrice = numeric(current.offer_price ?? current.regular_price);
      const priceDelta = currentPrice && previousPrice ? currentPrice - previousPrice : 0;
      const priceDeltaPct = previousPrice > 0 ? priceDelta / previousPrice * 100 : 0;
      return {
        ...change,
        name: String(current.name ?? previous.name ?? `SKU ${change.external_id}`),
        brand: String(current.brand ?? previous.brand ?? ""),
        category: String(current.category ?? previous.category ?? ""),
        previousPrice,
        currentPrice,
        priceDelta,
        priceDeltaPct,
      };
    }).filter((item) =>
      scopeAllows(access, "brands", item.brand)
      && scopeAllows(access, "categories", item.category),
    ).slice(0, 150);

    const priceChanges = enriched.filter((item) => item.priceDelta !== 0);
    const stockChanges = enriched.filter((item) => {
      const previous = item.previous_values ?? {};
      const current = item.current_values ?? {};
      return previous.in_stock !== undefined && current.in_stock !== undefined && previous.in_stock !== current.in_stock;
    });

    return NextResponse.json({
      changes: enriched,
      summary: {
        total: enriched.length,
        priceChanges: priceChanges.length,
        priceIncreases: priceChanges.filter((item) => item.priceDelta > 0).length,
        priceDecreases: priceChanges.filter((item) => item.priceDelta < 0).length,
        stockChanges: stockChanges.length,
      },
      organizationId: access.organizationId,
      generatedAt: new Date().toISOString(),
      baselineReady: enriched.length > 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
