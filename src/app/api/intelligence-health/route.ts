import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { openAiIntelligenceConfigured, openAiIntelligenceModel } from "@/lib/openai-intelligence";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-intelligence");
  if (authorization.response) return authorization.response;

  const clickhouse = clickHouseConfigured();
  const agent = openAiIntelligenceConfigured();

  return NextResponse.json({
    ok: clickhouse && agent,
    clickhouseConfigured: clickhouse,
    openaiConfigured: agent,
    model: agent ? openAiIntelligenceModel() : null,
    runtime: agent ? "openai_clickhouse" : "legacy_supabase",
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}
