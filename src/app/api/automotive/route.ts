import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import {
  supabaseAutomotiveBrandVariations,
  supabaseAutomotiveCatalog,
  supabaseAutomotiveOptions,
  supabaseAutomotiveVariations,
  type AutomotiveBrandComparison,
} from "@/lib/supabase-automotive";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIVE_DATA_HEADERS = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "automotive");
  if (authorization.response) return authorization.response;
  if (!authorization.access) {
    return NextResponse.json({ error: "No fue posible resolver el acceso automotriz." }, { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const filters = {
    brand: params.get("brand"),
    model: params.get("model"),
    dealer: params.get("dealer"),
  };

  try {
    if (params.get("options") === "1") {
      const result = await supabaseAutomotiveOptions(request, authorization.access);
      if (result.response) return result.response;
      return NextResponse.json(result.data, {
        headers: { "cache-control": "private, max-age=60, must-revalidate" },
      });
    }

    if (params.get("mode") === "variations") {
      const result = await supabaseAutomotiveVariations(request, authorization.access, filters);
      if (result.response) return result.response;
      return NextResponse.json(result.data, { headers: LIVE_DATA_HEADERS });
    }

    if (params.get("mode") === "brand_variations") {
      const comparison: AutomotiveBrandComparison = params.get("comparison") === "previous_month"
        ? "previous_month"
        : "previous_week";
      const result = await supabaseAutomotiveBrandVariations(request, authorization.access, filters, comparison);
      if (result.response) return result.response;
      return NextResponse.json(result.data, { headers: LIVE_DATA_HEADERS });
    }

    const result = await supabaseAutomotiveCatalog(request, authorization.access, filters);
    if (result.response) return result.response;
    return NextResponse.json(result.data, { headers: LIVE_DATA_HEADERS });
  } catch (error) {
    console.error("automotive-supabase-api", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "No fue posible cargar la inteligencia automotriz desde Supabase.", source: "supabase" },
      { status: 503 },
    );
  }
}
