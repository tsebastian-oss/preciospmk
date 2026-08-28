import { NextRequest } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const days = Math.max(1, Math.min(365, Number(request.nextUrl.searchParams.get("days") || 30)));
  const organizationId = request.nextUrl.searchParams.get("organizationId") || null;
  return enterpriseJson(await enterpriseRpc(request, "admin_usage_dashboard", {
    p_days: days,
    p_organization_id: organizationId,
  }));
}
