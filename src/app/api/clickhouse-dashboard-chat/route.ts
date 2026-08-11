import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import {
  openAiIntelligenceConfigured,
  runOpenAiIntelligenceAgent,
  type IntelligenceChatMessage,
  type IntelligenceFilters,
} from "@/lib/openai-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanMessages(value: unknown): IntelligenceChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item: any) => ({ role: item.role, content: item.content.trim().slice(0, 4_000) }))
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

function cleanFilters(value: unknown): IntelligenceFilters {
  const filters = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    retailerType: "all",
    supermarket: typeof filters.supermarket === "string" ? filters.supermarket.trim().slice(0, 100) : "",
    category: typeof filters.category === "string" ? filters.category.trim().slice(0, 180) : "",
    brand: typeof filters.brand === "string" ? filters.brand.trim().slice(0, 120) : "",
    query: "",
    stock: "all",
    period: [7, 30, 90].includes(Number(filters.period)) ? Number(filters.period) : 30,
  };
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });

  if (!openAiIntelligenceConfigured()) {
    return NextResponse.json({ error: "MGP Intelligence no está configurado.", runtime: "openai_clickhouse" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const messages = cleanMessages(body?.messages);
    const filters = cleanFilters(body?.filters);
    const lastUser = [...messages].reverse().find((item) => item.role === "user")?.content;
    if (!lastUser) return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });

    const result = await runOpenAiIntelligenceAgent(messages, filters, authorization.access) as Awaited<ReturnType<typeof runOpenAiIntelligenceAgent>> & {
      dashboardContext?: unknown;
    };

    return NextResponse.json({
      ...result,
      agentRuntime: "openai_clickhouse",
      source: "clickhouse",
    }, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.warn("Contextual dashboard chat failed", {
      name: error instanceof Error ? error.name : "unknown",
      status: Number((error as { status?: number })?.status || 0) || undefined,
    });
    return NextResponse.json({
      error: "No fue posible responder con MGP Intelligence en este momento.",
      runtime: "openai_clickhouse",
    }, { status: 503 });
  }
}
