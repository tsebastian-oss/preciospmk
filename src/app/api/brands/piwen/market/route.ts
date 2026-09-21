import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import {
  piwenMarketIntelligence,
  type PiwenMarketSnapshot,
  type PiwenOfficialSnapshot,
} from "@/lib/piwen-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MarketplaceSnapshot = Record<string, unknown>;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }

  const [supermarketResult, marketplaceResult, officialResult] = await Promise.allSettled([
    enterpriseRpc<PiwenMarketSnapshot>(request, "brands_piwen_supermarket_snapshot", { p_slug: "piwen" }),
    enterpriseRpc<MarketplaceSnapshot>(request, "brands_piwen_marketplace_snapshot", { p_slug: "piwen" }),
    enterpriseRpc<PiwenOfficialSnapshot>(request, "brands_piwen_official_snapshot", { p_slug: "piwen" }),
  ]);

  const supermarket = supermarketResult.status === "fulfilled" && !supermarketResult.value.response
    ? supermarketResult.value.data ?? null
    : null;

  const marketplace = marketplaceResult.status === "fulfilled" && !marketplaceResult.value.response
    ? marketplaceResult.value.data ?? null
    : null;

  const official = officialResult.status === "fulfilled" && !officialResult.value.response
    ? officialResult.value.data ?? null
    : null;

  if (supermarketResult.status === "rejected") console.warn("piwen-supermarket-supabase", supermarketResult.reason);
  if (marketplaceResult.status === "rejected") console.warn("piwen-marketplace-supabase", marketplaceResult.reason);
  if (officialResult.status === "rejected") console.warn("piwen-official-supabase", officialResult.reason);

  const payload = piwenMarketIntelligence(supermarket, official);

  return NextResponse.json({ ...payload, marketplace, official }, {
    headers: {
      "cache-control": "private, max-age=120, stale-while-revalidate=300",
      "x-piwen-data-mode": supermarket ? "supabase-live" : official ? "official-only" : "empty",
    },
  });
}
