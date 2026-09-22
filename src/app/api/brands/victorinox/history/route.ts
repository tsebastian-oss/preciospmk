import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseReadRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoryPayload = {
  source: "supabase-current-market-captures";
  brand: string;
  days: number;
  method: string;
  categories: Array<{ category: string; points: unknown[] }>;
};

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "brand-panel");
  if (auth.response) return auth.response;
  if (!auth.access || !brandScopeAllows(auth.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }

  const requested = Number(request.nextUrl.searchParams.get("days") || 30);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const result = await enterpriseReadRpc<HistoryPayload>(
    request,
    "victorinox_market_history_payload",
    { p_days: days },
  );
  if (result.response) return result.response;

  return NextResponse.json(
    result.data ?? {
      source: "supabase-current-market-captures",
      brand: "Victorinox",
      days,
      method: "current_market_snapshot_series_no_backfill",
      categories: [],
    },
    { headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
