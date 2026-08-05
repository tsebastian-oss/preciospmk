import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRest } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const limit = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("limit") ?? 50)));
  if (!organizationId) return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });

  return enterpriseJson(await enterpriseRest(request, "audit_logs", {
    query: {
      select: "id,organization_id,actor_user_id,action,entity_type,entity_id,old_values,new_values,metadata,created_at",
      organization_id: `eq.${organizationId}`,
      order: "created_at.desc",
      limit: String(limit),
    },
  }), []);
}
