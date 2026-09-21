import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PiwenHistoryPayload = {
  from: string | null;
  to: string | null;
  brands: string[];
  families: string[];
  points: Array<Record<string, unknown>>;
  methodology: string;
  piwenBasis: Record<string, string>;
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }

  const result = await enterpriseRpc<PiwenHistoryPayload>(
    request,
    "brands_piwen_history_snapshot",
    { p_slug: "piwen" },
  );

  if (result.response) return result.response;
  if (!result.data) {
    return NextResponse.json({ error: "No fue posible cargar el histórico competitivo desde Supabase." }, { status: 503 });
  }

  return NextResponse.json(result.data, {
    headers: {
      "cache-control": "private, max-age=300, stale-while-revalidate=600",
      "x-piwen-history-source": "supabase",
    },
  });
}
