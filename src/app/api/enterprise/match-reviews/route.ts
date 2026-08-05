import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  if (!organizationId) return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  return enterpriseJson(await enterpriseRest(request, "match_reviews", {
    query: {
      select: "*",
      organization_id: `eq.${organizationId}`,
      status: status === "all" ? undefined : `eq.${status}`,
      order: "created_at.desc",
      limit: "100",
    },
  }), []);
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as {
    organizationId?: string;
    targetProductId?: string;
    candidateProductId?: string;
    relationship?: string;
    status?: string;
    confidence?: number;
    reasons?: string[];
    notes?: string;
  };
  if (!payload.organizationId || !payload.targetProductId || !payload.candidateProductId || !payload.relationship) {
    return NextResponse.json({ error: "Faltan datos del match" }, { status: 400 });
  }
  return enterpriseJson(await enterpriseRpc(request, "enterprise_review_match", {
    p_organization_id: payload.organizationId,
    p_target_product_id: payload.targetProductId,
    p_candidate_product_id: payload.candidateProductId,
    p_relationship: payload.relationship,
    p_status: payload.status ?? "pending",
    p_confidence: payload.confidence ?? null,
    p_reasons: payload.reasons ?? [],
    p_notes: payload.notes ?? null,
  }));
}
