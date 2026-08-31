import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { piwenMarketFallback, piwenMarketIntelligence } from "@/lib/piwen-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function within<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("piwen_market_timeout")), timeoutMs)),
  ]);
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }

  const marketPromise = clickHouseConfigured()
    ? within(piwenMarketIntelligence(authorization.access), 6_500)
    : Promise.reject(new Error("clickhouse_not_configured"));

  const [marketResult, marketplaceResult] = await Promise.allSettled([
    marketPromise,
    enterpriseRpc<Record<string, unknown>>(request, "brands_piwen_marketplace_snapshot", { p_slug: "piwen" }),
  ]);

  const payload = marketResult.status === "fulfilled" ? marketResult.value : piwenMarketFallback();
  if (marketResult.status === "rejected") {
    console.warn("piwen-market-continuity", marketResult.reason);
  }

  const marketplace = marketplaceResult.status === "fulfilled" && !marketplaceResult.value.response
    ? marketplaceResult.value.data ?? null
    : null;

  return NextResponse.json({ ...payload, marketplace }, {
    headers: {
      "cache-control": "private, max-age=120, stale-while-revalidate=300",
      "x-piwen-data-mode": marketResult.status === "fulfilled" ? "live" : "continuity",
    },
  });
}
