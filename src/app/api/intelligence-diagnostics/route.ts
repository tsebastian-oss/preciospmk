import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { executeIntelligenceTool } from "@/lib/clickhouse-intelligence";
import { probeOpenAiIntelligence } from "@/lib/openai-intelligence";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-intelligence");
  if (authorization.response) return authorization.response;

  const access = authorization.access!;
  const clickhouseConfigured = clickHouseConfigured();

  const clickhouseProbe = clickhouseConfigured
    ? await executeIntelligenceTool("search_products", {
      query: "Coca Cola Zero lata",
      brand: "Coca-Cola",
      retailerType: "supermarket",
      supermarkets: ["Jumbo"],
      category: null,
      stock: "all",
      limit: 5,
    }, access).then((result: any) => ({
      ok: Boolean(result?.found),
      matches: Array.isArray(result?.products) ? result.products.length : 0,
      sample: Array.isArray(result?.products) ? result.products.slice(0, 3).map((item: any) => ({
        name: item?.name ?? null,
        retailer: item?.retailer ?? null,
        price: item?.current_price ?? null,
      })) : [],
    })).catch(() => ({ ok: false, matches: 0, sample: [] }))
    : { ok: false, matches: 0, sample: [] };

  const openaiProbe = await probeOpenAiIntelligence();

  return NextResponse.json({
    ok: clickhouseProbe.ok && openaiProbe.ok,
    clickhouseConfigured,
    clickhouseProbe,
    openaiProbe,
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}
