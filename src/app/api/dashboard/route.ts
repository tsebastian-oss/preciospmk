import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const result = await enterpriseRpc<Record<string, unknown>>(request, "enterprise_dashboard_bootstrap", {
    p_organization_id: authorization.access?.organizationId,
  });
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    summary: null,
    supermarkets: [],
    categories: [],
    run: null,
    topOffers: [],
  });
}
