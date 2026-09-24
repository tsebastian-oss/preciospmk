import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseReadRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TYPES = new Set(["auto_finance", "credit_card", "consumer_credit", "benchmark"]);

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "automotive");
  if (authorization.response) return authorization.response;
  if (!authorization.access) {
    return NextResponse.json({ error: "No fue posible resolver el acceso automotriz." }, { status: 500 });
  }

  const sourceType = request.nextUrl.searchParams.get("type");
  if (sourceType && !TYPES.has(sourceType)) {
    return NextResponse.json({ error: "Tipo de financiamiento inválido." }, { status: 400 });
  }

  try {
    const result = await enterpriseReadRpc(request, "automotive_financing_current", {
      p_organization_id: authorization.access.organizationId,
      p_source_type: sourceType || null,
    }, { attempts: 2, timeoutMs: 15_000 });
    if (result.response) return result.response;
    return NextResponse.json(result.data, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("automotive-financing-api", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json(
      { error: "No fue posible cargar las condiciones de financiamiento.", source: "supabase" },
      { status: 503 },
    );
  }
}
