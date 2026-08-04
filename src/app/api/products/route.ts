import { NextRequest, NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    const products = await supabaseRest<unknown[]>("latest_prices", {
      query: {
        select: "*",
        order: "offer_price.asc",
        limit: "100",
        ...(q ? { name: `ilike.*${q.replace(/[*,]/g, "")}*` } : {})
      }
    });
    return NextResponse.json({ products });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
