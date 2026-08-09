import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type CoveragePayload = {
  generatedAt?: string;
  retailers?: Array<{
    name: string;
    retailerType: string;
    products: number;
    validPriceProducts: number;
    freshnessStatus: "fresh" | "warning" | "stale" | string;
    latestObservedAt: string | null;
    ageHours: number | string | null;
  }>;
};

export async function GET() {
  try {
    const data = await supabaseRest<CoveragePayload>("rpc/public_marketing_coverage", { method: "POST", body: {} });
    return NextResponse.json(data ?? { retailers: [] }, {
      headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ retailers: [], error: "No fue posible cargar la cobertura en este momento." }, { status: 503 });
  }
}
